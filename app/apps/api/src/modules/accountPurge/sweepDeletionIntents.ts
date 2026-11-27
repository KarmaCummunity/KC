// The verified re-sweep of storage deletion intents (FR-SETTINGS-012 AC4;
// the migration `storage_deletion_intents`). Ported from
// supabase/functions/purge-deleted-accounts/sweep.ts.
//
// The purge empties a member's folders before it deletes the identity, and the
// database records one intent per folder in the same transaction as that
// deletion. A write that commits later (an upload a device or a worker gave up
// on, which the store still accepted) would otherwise stay. Each run, after
// the accounts, this takes the due intents and for each one:
//   1. removes everything in the folder;
//   2. looks again, and reports what it removed and what was still there.
// The database closes an intent only when the second look found nothing after
// the intent's quiet window; otherwise it schedules another sweep. A failure
// is recorded on the intent (it backs off) and never stops the others.
// Deletion is eventual and re-checked, not a fence around the store.

export interface DeletionIntent {
  readonly id: number;
  readonly bucket: string;
  /** A folder without a trailing slash: `<user_id>` or `derived/<user_id>`. */
  readonly prefix: string;
}

/**
 * What the database decided about one sweep: `verified` closed the intent,
 * `pending` keeps it for a later sweep, `retry` backs it off after a failure,
 * `unknown` is no open intent with that id.
 */
export type SweepAnswer = 'verified' | 'pending' | 'retry' | 'unknown';

/** Database port of the sweep; each method is one statement calling one database function. */
export interface SweepDatabase {
  dueIntents(limit: number): Promise<DeletionIntent[]>;
  /** Records one sweep: what was removed, what a second look still saw, or the error. */
  recordSweep(id: number, found: number, remaining: number, error: string | null): Promise<SweepAnswer>;
  /** Deletes closed intents past their retention; returns how many. */
  pruneIntents(): Promise<number>;
}

/** File port of the sweep; every method rejects on a storage error. */
export interface SweepFiles {
  /** Empties `<folder>/` of a bucket and returns how many stored objects it removed. */
  removeFolder(bucket: string, folder: string): Promise<number>;
  /** How many objects are stored under `<folder>/`. */
  countFolder(bucket: string, folder: string): Promise<number>;
}

export interface SweepSummary {
  verified: number;
  pending: number;
  failed: number;
}

/** Intents swept per run; the rest wait for the next run. */
export const SWEEP_BATCH = 50;
/** Most of an error's text kept on an intent. The text only: no path, which would hold a user id. */
const MAX_ERROR_LENGTH = 500;

/** Removes everything under the intent's folder, then looks again. */
export async function sweepIntent(files: SweepFiles, intent: DeletionIntent): Promise<{ found: number; remaining: number }> {
  const found = await files.removeFolder(intent.bucket, intent.prefix);
  const remaining = await files.countFolder(intent.bucket, intent.prefix);
  return { found, remaining };
}

/**
 * Sweeps the due intents one by one; a failing intent is recorded and
 * reported, and the rest go on.
 * @param report Receives a failure with the intent's id only.
 * @throws When the due intents cannot be read or the closed ones cannot be pruned.
 */
export async function sweepDueIntents(db: SweepDatabase, files: SweepFiles, report: (error: unknown, intentId: number) => void): Promise<SweepSummary> {
  const summary: SweepSummary = { verified: 0, pending: 0, failed: 0 };
  for (const intent of await db.dueIntents(SWEEP_BATCH)) {
    let answer: SweepAnswer;
    try {
      const { found, remaining } = await sweepIntent(files, intent);
      answer = await db.recordSweep(intent.id, found, remaining, null);
    } catch (error) {
      report(error, intent.id);
      const message = error instanceof Error ? error.message : String(error);
      answer = await db.recordSweep(intent.id, 0, 0, message.slice(0, MAX_ERROR_LENGTH)).catch(() => 'retry' as const);
    }
    if (answer === 'verified') summary.verified += 1;
    else if (answer === 'retry') summary.failed += 1;
    else if (answer === 'pending') summary.pending += 1;
  }
  await db.pruneIntents();
  return summary;
}
