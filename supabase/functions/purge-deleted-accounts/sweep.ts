// purge-deleted-accounts · the verified re-sweep of storage deletion intents
// (supabase/migrations/*_storage_deletion_intents.sql; DESIGN.md §4, phase 1).
//
// The purge empties a member's folders before it deletes the identity, and records one intent per
// folder in the same transaction as that deletion. A write that commits later (an upload a device or
// a worker aborted, which Storage still committed) would otherwise stay. Each run, after the
// accounts, this takes the due intents and for each one:
//   1. lists the folder and deletes everything in it;
//   2. lists it again, and reports what it found and what was still there.
// The database closes an intent only when the second listing was empty after the intent's quiet
// window; otherwise it schedules another sweep. A failure is recorded on the intent (it backs off)
// and never stops the other intents. Deletion is eventual and re-checked, not a storage fence.
import { chunkPaths, collectObjectPaths, type StorageListEntry } from '../_shared/storageCleanup.ts';

export interface DeletionIntent {
  readonly id: number;
  readonly bucket: string;
  /** A folder without a trailing slash: `<user_id>` or `derived/<user_id>`. */
  readonly prefix: string;
}

export type SweepAnswer = 'verified' | 'pending' | 'retry' | 'unknown';

/** Database side of the sweep; each method is one statement calling one database function. */
export interface SweepDatabase {
  dueIntents(limit: number): Promise<DeletionIntent[]>;
  /** Records one sweep: what was found and deleted, what the second listing still saw, or the error. */
  recordSweep(id: number, found: number, remaining: number, error: string | null): Promise<SweepAnswer>;
  /** Deletes closed intents past their retention; returns how many. */
  pruneIntents(): Promise<number>;
}

/** Storage side; every method rejects on a storage error. */
export interface SweepStorage {
  list(bucket: string, prefix: string, offset: number, limit: number): Promise<StorageListEntry[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface SweepSummary {
  verified: number;
  pending: number;
  failed: number;
}

/** Intents swept per run; the rest wait for the next run. */
export const SWEEP_BATCH = 50;

/** Deletes everything under the intent's folder, then lists it again. */
export async function sweepIntent(storage: SweepStorage, intent: DeletionIntent): Promise<{ found: number; remaining: number }> {
  const list = (prefix: string, offset: number, limit: number) => storage.list(intent.bucket, prefix, offset, limit);
  const found = await collectObjectPaths(list, intent.prefix);
  for (const chunk of chunkPaths(found)) await storage.remove(intent.bucket, chunk);
  const remaining = await collectObjectPaths(list, intent.prefix);
  return { found: found.length, remaining: remaining.length };
}

/** Sweeps the due intents one by one; a failing intent is recorded and reported, the rest go on. */
export async function sweepDueIntents(
  db: SweepDatabase,
  storage: SweepStorage,
  report: (error: unknown, intentId: number) => Promise<void>,
): Promise<SweepSummary> {
  const summary: SweepSummary = { verified: 0, pending: 0, failed: 0 };
  for (const intent of await db.dueIntents(SWEEP_BATCH)) {
    let answer: SweepAnswer;
    try {
      const { found, remaining } = await sweepIntent(storage, intent);
      answer = await db.recordSweep(intent.id, found, remaining, null);
    } catch (error) {
      await report(error, intent.id);
      // The error text only (no paths): it is stored on the intent and backs it off.
      const message = error instanceof Error ? error.message : String(error);
      answer = await db.recordSweep(intent.id, 0, 0, message.slice(0, 500)).catch(() => 'retry' as const);
    }
    if (answer === 'verified') summary.verified += 1;
    else if (answer === 'retry') summary.failed += 1;
    else if (answer === 'pending') summary.pending += 1;
  }
  await db.pruneIntents();
  return summary;
}

/** The statements of the sweep; each names one database function. */
export const SWEEP_SQL = {
  dueIntents: 'select d.id, d.bucket, d.prefix from kc_private.storage_deletion_intents_due($1::integer) d',
  recordSweep: 'select kc_private.storage_deletion_intent_swept($1::bigint, $2::integer, $3::integer, $4::text) as answer',
  pruneIntents: 'select kc_private.storage_deletion_intents_prune() as pruned',
} as const;

type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export function createSweepDatabase(query: Query): SweepDatabase {
  return {
    async dueIntents(limit) {
      return (await query(SWEEP_SQL.dueIntents, [limit])).map((row) => ({
        id: Number(row.id), bucket: String(row.bucket), prefix: String(row.prefix),
      }));
    },
    async recordSweep(id, found, remaining, error) {
      return String((await query(SWEEP_SQL.recordSweep, [id, found, remaining, error]))[0]?.answer ?? 'unknown') as SweepAnswer;
    },
    async pruneIntents() {
      return Number((await query(SWEEP_SQL.pruneIntents, []))[0]?.pruned ?? 0);
    },
  };
}
