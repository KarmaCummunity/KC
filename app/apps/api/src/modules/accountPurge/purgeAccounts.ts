// The purge of accounts past their 30-day grace period (FR-SETTINGS-012 AC4,
// docs/db/target-design.md §4.1). Ported from supabase/functions/purge-deleted-accounts.
//
// Per account, in this order:
//   1. database: deletion tombstone + money records detached   (repeatable)
//      then the member's photo jobs are stopped (kc_private.post_media_purge_hold); while a
//      stopped worker's lease is still running the account is DEFERRED (this run removes none
//      of its files), so step 2 runs only once the workers have stopped writing.
//   2. files:    the member's folder `<user_id>/` in every bucket, and the server-made copies
//                of their photos under `derived/<user_id>/` in post-images (repeatable)
//   3. database: a storage deletion intent per folder of the member is recorded, and the auth
//                identity is deleted (every row of the member cascades; the intents do not)
// An account stays due until step 3 succeeded, so a failed account is retried by the next run
// and never blocks the others. After the accounts, every run re-sweeps the due deletion intents
// (sweepDeletionIntents.ts): an object that was stored after step 2 is removed, and an intent
// closes only when its folder is found empty after its quiet window.

/**
 * Folders of a member that server code writes on their behalf, outside their own `<user_id>/`
 * folder, per bucket. `post-images`: the sanitized photo copies of the media job
 * (kc_private.post_media_derivative_key: `derived/<owner>/<media>-a<n>.jpg`).
 */
export const SERVICE_FOLDERS: Readonly<Record<string, (userId: string) => string[]>> = {
  'post-images': (userId) => [`derived/${userId}`],
};

/** Every folder of the member in `bucket` the purge must empty. */
export function memberFolders(bucket: string, userId: string): string[] {
  return [userId, ...(SERVICE_FOLDERS[bucket]?.(userId) ?? [])];
}

/** Database port; each method is one statement calling one database function. */
export interface PurgeDatabase {
  dueAccounts(limit: number): Promise<string[]>;
  prepare(userId: string): Promise<void>;
  /** Stops the member's photo jobs; true while a stopped worker may still be writing. */
  holdForMedia(userId: string): Promise<boolean>;
  /** False when the account was already gone. */
  finish(userId: string): Promise<boolean>;
}

/** File port; every method rejects on a storage error. */
export interface PurgeFiles {
  buckets(): Promise<string[]>;
  /** Empties `<folder>/` of a bucket: the stored objects and their rows. */
  removeFolder(bucket: string, folder: string): Promise<unknown>;
}

export type PurgeStage = 'prepare' | 'files' | 'finish';

export interface PurgeDeps {
  readonly db: PurgeDatabase;
  readonly files: PurgeFiles;
  /** Receives a failure with ids only; never the member's data. */
  readonly report: (error: unknown, tags: { stage: PurgeStage; user_id: string }) => void;
}

export type PurgeOutcome = { stage: PurgeStage; error: unknown } | 'deferred' | null;

/**
 * Purges one account; resolves to null when it is gone, 'deferred' when a photo job of the
 * member still holds a lease (the account stays due; nothing is removed this run), or the
 * stage that failed.
 */
export async function purgeAccount(deps: Pick<PurgeDeps, 'db' | 'files'>, userId: string, buckets: readonly string[]): Promise<PurgeOutcome> {
  let stage: PurgeStage = 'prepare';
  try {
    await deps.db.prepare(userId);
    if (await deps.db.holdForMedia(userId)) return 'deferred';
    stage = 'files';
    for (const bucket of buckets) {
      for (const folder of memberFolders(bucket, userId)) await deps.files.removeFolder(bucket, folder);
    }
    stage = 'finish';
    await deps.db.finish(userId);
    return null;
  } catch (error) {
    return { stage, error };
  }
}

export interface PurgeSummary {
  purged: number;
  failed: number;
  /** Accounts left for the next run because a photo job still held a lease: not an error. */
  deferred: number;
}

/**
 * One purge run over at most `batchSize` due accounts.
 * @throws When the due accounts or the buckets cannot be read: nothing was purged.
 */
export async function purgeDueAccounts(deps: PurgeDeps, batchSize: number): Promise<PurgeSummary> {
  const due = await deps.db.dueAccounts(batchSize);
  const buckets = due.length > 0 ? await deps.files.buckets() : [];
  const summary: PurgeSummary = { purged: 0, failed: 0, deferred: 0 };
  for (const userId of due) {
    const outcome = await purgeAccount(deps, userId, buckets);
    if (outcome === null) {
      summary.purged += 1;
    } else if (outcome === 'deferred') {
      summary.deferred += 1;
    } else {
      summary.failed += 1;
      deps.report(outcome.error, { stage: outcome.stage, user_id: userId });
    }
  }
  return summary;
}
