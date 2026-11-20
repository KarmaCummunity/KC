// purge-deleted-accounts — the purge of accounts past their 30-day grace period
// (FR-SETTINGS-012 AC4, docs/db/target-design.md §4.1), against two ports.
//
// Per account, in this order (supabase/schemas/95_platform/100_purge_contract.sql):
//   1. database: deletion tombstone + money records detached   (repeatable)
//      then the member's photo jobs are stopped (kc_private.post_media_purge_hold); while a stopped
//      worker's lease is still running the account is DEFERRED to a later run, untouched, so no
//      worker can write into `derived/<user_id>/` after step 2 empties it
//   2. storage:  the member's folder `<user_id>/` in every bucket, and the server-made copies of
//                their photos under `derived/<user_id>/` in post-images (repeatable)
//   3. database: the auth identity is deleted; every row of the member cascades
// An account stays due until step 3 succeeded, so a failed account is retried by the next
// run and never blocks the others.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { chunkPaths, collectObjectPaths, type StorageListEntry } from '../_shared/storageCleanup.ts';

/**
 * Folders of a member that server code writes on their behalf, outside their own `<user_id>/`
 * folder, per bucket. `post-images`: the sanitized photo copies of process-post-media
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

/** Storage port; every method rejects on a storage error. */
export interface PurgeStorage {
  buckets(): Promise<string[]>;
  list(bucket: string, prefix: string, offset: number, limit: number): Promise<StorageListEntry[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export type PurgeStage = 'prepare' | 'storage' | 'finish';
/** Receives a failure with ids only; never the member's data. */
export type PurgeReporter = (error: unknown, tags: { stage: PurgeStage | 'list_due'; user_id?: string }) => Promise<void>;

export interface PurgeDeps {
  readonly db: PurgeDatabase;
  readonly storage: PurgeStorage;
  readonly serviceRoleKey: string | string[];
  readonly report: PurgeReporter;
  /** Accounts per run; the rest wait for the next run. */
  readonly batchSize?: number;
}

export type PurgeOutcome = { stage: PurgeStage; error: unknown } | 'deferred' | null;

/**
 * Purges one account; resolves to null when it is gone, 'deferred' when a photo worker of the
 * member may still be writing (it stays due), or the stage that failed.
 */
export async function purgeAccount(deps: Pick<PurgeDeps, 'db' | 'storage'>, userId: string, buckets: string[]): Promise<PurgeOutcome> {
  let stage: PurgeStage = 'prepare';
  try {
    await deps.db.prepare(userId);
    if (await deps.db.holdForMedia(userId)) return 'deferred';
    stage = 'storage';
    for (const bucket of buckets) {
      for (const folder of memberFolders(bucket, userId)) {
        const paths = await collectObjectPaths((prefix, offset, limit) => deps.storage.list(bucket, prefix, offset, limit), folder);
        for (const chunk of chunkPaths(paths)) await deps.storage.remove(bucket, chunk);
      }
    }
    stage = 'finish';
    await deps.db.finish(userId);
    return null;
  } catch (error) {
    return { stage, error };
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createPurgeHandler(deps: PurgeDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();

    let due: string[];
    let buckets: string[];
    try {
      due = await deps.db.dueAccounts(deps.batchSize ?? 50);
      buckets = due.length > 0 ? await deps.storage.buckets() : [];
    } catch (error) {
      await deps.report(error, { stage: 'list_due' });
      return json({ ok: false, error: 'list_failed' }, 500);
    }

    let purged = 0;
    let failed = 0;
    let deferred = 0;
    for (const userId of due) {
      const outcome = await purgeAccount(deps, userId, buckets);
      if (outcome === null) {
        purged += 1;
      } else if (outcome === 'deferred') {
        deferred += 1; // not an error: the next run purges it once the lease has run out
      } else {
        failed += 1;
        await deps.report(outcome.error, { stage: outcome.stage, user_id: userId });
      }
    }
    return json({ ok: true, purged, failed, deferred });
  };
}

/** The database port over a Postgres connection; the statements name the contract. */
export const PURGE_SQL = {
  dueAccounts: 'select a.user_id from kc_private.accounts_due_for_purge($1::integer) a',
  prepare: 'select kc_private.account_purge_prepare($1::uuid)',
  holdForMedia: 'select kc_private.post_media_purge_hold($1::uuid) as held',
  finish: 'select kc_private.account_purge_finish($1::uuid) as finished',
} as const;

export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export function createPurgeDatabase(query: Query): PurgeDatabase {
  return {
    async dueAccounts(limit) {
      return (await query(PURGE_SQL.dueAccounts, [limit])).map((row) => String(row.user_id));
    },
    async prepare(userId) {
      await query(PURGE_SQL.prepare, [userId]);
    },
    async holdForMedia(userId) {
      return (await query(PURGE_SQL.holdForMedia, [userId]))[0]?.held === true;
    },
    async finish(userId) {
      return (await query(PURGE_SQL.finish, [userId]))[0]?.finished === true;
    },
  };
}
