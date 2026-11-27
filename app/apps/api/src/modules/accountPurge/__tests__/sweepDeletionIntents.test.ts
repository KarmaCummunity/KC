import { describe, expect, it } from 'vitest';
import { type DeletionIntent, type SweepAnswer, type SweepDatabase, sweepDueIntents, type SweepFiles, sweepIntent } from '../sweepDeletionIntents';

const INTENT_A: DeletionIntent = { id: 1, bucket: 'post-images', prefix: 'user-a' };
const INTENT_B: DeletionIntent = { id: 2, bucket: 'post-images', prefix: 'derived/user-a' };

interface Setup {
  readonly due: DeletionIntent[];
  /** Objects stored under each `<bucket>/<folder>` before the sweep. */
  readonly stored?: Record<string, number>;
  /** Objects that appear again after a folder was emptied (a write that landed in between). */
  readonly reappearing?: Record<string, number>;
  /** Folders whose removal fails. */
  readonly failing?: string[];
  /** What the database answers per intent id; `verified` unless told otherwise. */
  readonly answers?: Record<number, SweepAnswer>;
  readonly recordFails?: boolean;
}

/** Ports over an in-memory store that remember what the database was told. */
function setup({ due, stored = {}, reappearing = {}, failing = [], answers = {}, recordFails = false }: Setup) {
  const counts = new Map(Object.entries(stored));
  const recorded: Array<{ id: number; found: number; remaining: number; error: string | null }> = [];
  const reported: Array<{ message: string; intentId: number }> = [];
  let pruned = 0;
  const db: SweepDatabase = {
    dueIntents: () => Promise.resolve(due),
    recordSweep: (id, found, remaining, error) => {
      if (recordFails) return Promise.reject(new Error('database unavailable'));
      recorded.push({ id, found, remaining, error });
      return Promise.resolve(error === null ? (answers[id] ?? 'verified') : 'retry');
    },
    pruneIntents: () => {
      pruned += 1;
      return Promise.resolve(0);
    },
  };
  const files: SweepFiles = {
    removeFolder: (bucket, folder) => {
      const key = `${bucket}/${folder}`;
      if (failing.includes(key)) return Promise.reject(new Error(`store refused ${key}`));
      const found = counts.get(key) ?? 0;
      counts.set(key, reappearing[key] ?? 0);
      return Promise.resolve(found);
    },
    countFolder: (bucket, folder) => Promise.resolve(counts.get(`${bucket}/${folder}`) ?? 0),
  };
  const run = () => sweepDueIntents(db, files, (error, intentId) => reported.push({ message: (error as Error).message, intentId }));
  return { db, files, run, recorded, reported, pruned: () => pruned };
}

describe('sweepIntent', () => {
  it('removes what is in the folder and reports what a second look still saw', async () => {
    const { files } = setup({ due: [], stored: { 'post-images/user-a': 3 }, reappearing: { 'post-images/user-a': 1 } });

    expect(await sweepIntent(files, INTENT_A)).toEqual({ found: 3, remaining: 1 });
  });
});

describe('sweepDueIntents', () => {
  it('tells the database what each sweep removed and what remained, and counts its answers', async () => {
    const { run, recorded } = setup({
      due: [INTENT_A, INTENT_B],
      stored: { 'post-images/user-a': 2 },
      answers: { 1: 'verified', 2: 'pending' },
    });

    expect(await run()).toEqual({ verified: 1, pending: 1, failed: 0 });
    expect(recorded).toEqual([
      { id: 1, found: 2, remaining: 0, error: null },
      { id: 2, found: 0, remaining: 0, error: null },
    ]);
  });

  it('records a failing intent with the error text only, reports it by id, and goes on with the rest', async () => {
    const { run, recorded, reported } = setup({ due: [INTENT_A, INTENT_B], failing: ['post-images/user-a'] });

    expect(await run()).toEqual({ verified: 1, pending: 0, failed: 1 });
    expect(recorded[0]).toEqual({ id: 1, found: 0, remaining: 0, error: 'store refused post-images/user-a' });
    expect(reported).toEqual([{ message: 'store refused post-images/user-a', intentId: 1 }]);
  });

  it('counts an intent whose failure could not even be recorded as failed', async () => {
    const { run } = setup({ due: [INTENT_A], failing: ['post-images/user-a'], recordFails: true });

    expect(await run()).toEqual({ verified: 0, pending: 0, failed: 1 });
  });

  it('counts an intent the database no longer knows in none of the three', async () => {
    const { run } = setup({ due: [INTENT_A], answers: { 1: 'unknown' } });

    expect(await run()).toEqual({ verified: 0, pending: 0, failed: 0 });
  });

  it('prunes the closed intents past their retention on every run, also with nothing due', async () => {
    const { run, pruned } = setup({ due: [] });

    await run();

    expect(pruned()).toBe(1);
  });
});
