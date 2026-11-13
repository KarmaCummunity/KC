// purge-deleted-accounts — the purge of accounts past their 30-day grace period
// (FR-SETTINGS-012 AC4, docs/db/target-design.md §4.1), against two ports.
//
// Per account, in this order (supabase/schemas/95_platform/100_purge_contract.sql):
//   1. database: deletion tombstone + money records detached   (repeatable)
//   2. storage:  the member's folder `<user_id>/` in every bucket (repeatable)
//   3. database: the auth identity is deleted; every row of the member cascades
// An account stays due until step 3 succeeded, so a failed account is retried by the next
// run and never blocks the others.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';
import { chunkPaths, collectObjectPaths, type StorageListEntry } from '../_shared/storageCleanup.ts';

/** Database port; each method is one statement calling one database function. */
export interface PurgeDatabase {
  dueAccounts(limit: number): Promise<string[]>;
  prepare(userId: string): Promise<void>;
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
  readonly serviceRoleKey: string;
  readonly report: PurgeReporter;
  /** Accounts per run; the rest wait for the next run. */
  readonly batchSize?: number;
}

/** Purges one account; resolves to the stage that failed, or null when it is gone. */
export async function purgeAccount(deps: Pick<PurgeDeps, 'db' | 'storage'>, userId: string, buckets: string[]): Promise<{ stage: PurgeStage; error: unknown } | null> {
  let stage: PurgeStage = 'prepare';
  try {
    await deps.db.prepare(userId);
    stage = 'storage';
    for (const bucket of buckets) {
      const paths = await collectObjectPaths((prefix, offset, limit) => deps.storage.list(bucket, prefix, offset, limit), userId);
      for (const chunk of chunkPaths(paths)) await deps.storage.remove(bucket, chunk);
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
    for (const userId of due) {
      const failure = await purgeAccount(deps, userId, buckets);
      if (failure === null) {
        purged += 1;
      } else {
        failed += 1;
        await deps.report(failure.error, { stage: failure.stage, user_id: userId });
      }
    }
    return json({ ok: true, purged, failed });
  };
}

/** The database port over a Postgres connection; the statements name the contract. */
export const PURGE_SQL = {
  dueAccounts: 'select a.user_id from kc_private.accounts_due_for_purge($1::integer) a',
  prepare: 'select kc_private.account_purge_prepare($1::uuid)',
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
    async finish(userId) {
      return (await query(PURGE_SQL.finish, [userId]))[0]?.finished === true;
    },
  };
}
