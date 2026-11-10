// _shared/accountPurge.ts — FR-SETTINGS-012 AC4: purges one account whose grace period has ended.
//
// The account stays `pending_deletion` until its auth identity is gone, so any failed stage is
// retried by the next daily run (0699). The order makes every stage safe to repeat:
//   1. read the post media paths (they are lost once the posts are deleted);
//   2. remove the post media and the user's Storage folders — any failure stops here;
//   3. delete the account's data (`delete_account_data_for`; the users row is kept);
//   4. delete the auth identity, which cascades the users row: the account is gone.

import { purgeUserFolders, type StorageGateway } from './storageCleanup.ts';

/** The bucket that holds the post media listed by `account_purge_media_paths`. */
export const POST_MEDIA_BUCKET = 'post-images';

/** The calls one purge needs; each rejects on failure. */
export interface AccountPurgeGateway {
  /** `account_purge_media_paths(user)`. */
  mediaPaths(userId: string): Promise<string[]>;
  /** Storage list / remove, used for the post media and the user's folders. */
  readonly storage: StorageGateway;
  /** `delete_account_data_for(user)`. */
  deleteData(userId: string): Promise<void>;
  /** `auth.admin.deleteUser(user)`; cascades the users row. */
  deleteIdentity(userId: string): Promise<void>;
}

/** The stage that failed, as reported to observability. */
export type PurgeStage = 'media_paths' | 'storage_cleanup' | 'db_purge' | 'auth_delete';

/** Receives a failure; `bucket` is set for Storage failures. The purge itself never throws. */
export type PurgeFailureReporter = (error: unknown, stage: PurgeStage, bucket?: string) => Promise<void>;

/** Removes the post media and every user folder; true when all of it went without error. */
async function purgeStorage(
  gateway: AccountPurgeGateway,
  userId: string,
  mediaPaths: string[],
  report: PurgeFailureReporter,
): Promise<boolean> {
  let clean = true;
  const fail = async (error: unknown, bucket: string) => {
    clean = false;
    await report(error, 'storage_cleanup', bucket);
  };
  if (mediaPaths.length > 0) {
    try {
      await gateway.storage.remove(POST_MEDIA_BUCKET, mediaPaths);
    } catch (error) {
      await fail(error, POST_MEDIA_BUCKET);
    }
  }
  await purgeUserFolders(gateway.storage, userId, fail);
  return clean;
}

/**
 * Purges one account. Returns true when it is gone completely; false leaves it
 * `pending_deletion`, listed again by the next run.
 */
export async function purgeAccount(
  gateway: AccountPurgeGateway,
  userId: string,
  report: PurgeFailureReporter,
): Promise<boolean> {
  let mediaPaths: string[];
  try {
    mediaPaths = await gateway.mediaPaths(userId);
  } catch (error) {
    await report(error, 'media_paths');
    return false;
  }

  if (!(await purgeStorage(gateway, userId, mediaPaths, report))) return false;

  try {
    await gateway.deleteData(userId);
  } catch (error) {
    await report(error, 'db_purge');
    return false;
  }

  try {
    await gateway.deleteIdentity(userId);
  } catch (error) {
    await report(error, 'auth_delete');
    return false;
  }
  return true;
}
