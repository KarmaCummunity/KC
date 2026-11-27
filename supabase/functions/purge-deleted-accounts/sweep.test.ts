// The verified re-sweep of storage deletion intents, against in-memory fakes.
// Run: deno test --allow-read purge-deleted-accounts   (from supabase/functions)
import { assertEquals } from 'jsr:@std/assert@1';
import type { StorageListEntry } from '../_shared/storageCleanup.ts';
import { createSweepDatabase, SWEEP_SQL, sweepDueIntents, type DeletionIntent, type SweepAnswer, type SweepDatabase, type SweepStorage } from './sweep.ts';

/** Records every sweep the way the database would answer it (window already passed). */
class FakeSweepDatabase implements SweepDatabase {
  readonly swept: { id: number; found: number; remaining: number; error: string | null }[] = [];
  pruned = 0;
  constructor(readonly due: DeletionIntent[]) {}
  dueIntents(limit: number) {
    return Promise.resolve(this.due.slice(0, limit));
  }
  recordSweep(id: number, found: number, remaining: number, error: string | null): Promise<SweepAnswer> {
    this.swept.push({ id, found, remaining, error });
    return Promise.resolve(error ? 'retry' : remaining === 0 ? 'verified' : 'pending');
  }
  pruneIntents() {
    this.pruned += 1;
    return Promise.resolve(0);
  }
}

/** One bucket per key; `afterRemove` lets a test commit a late write right after a delete. */
class FakeStorage implements SweepStorage {
  failBucket: string | null = null;
  afterRemove: (() => void) | null = null;
  constructor(readonly files: Record<string, Set<string>>) {}
  list(bucket: string, prefix: string, offset: number, limit: number) {
    if (bucket === this.failBucket) return Promise.reject(new Error('list HTTP 503'));
    const children = new Map<string, StorageListEntry>();
    for (const path of this.files[bucket] ?? []) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const [name, ...rest] = path.slice(prefix.length + 1).split('/');
      children.set(name, { name, id: rest.length > 0 ? null : 'object-id' });
    }
    return Promise.resolve([...children.values()].slice(offset, offset + limit));
  }
  remove(bucket: string, paths: string[]) {
    for (const path of paths) this.files[bucket].delete(path);
    this.afterRemove?.();
    this.afterRemove = null;
    return Promise.resolve();
  }
}

const noReport = () => Promise.resolve();

Deno.test('an object that landed after the purge is deleted, and an empty second listing closes the intent', async () => {
  const storage = new FakeStorage({ 'post-images': new Set(['derived/u1/m-a1.jpg', 'derived/u1/m-a1-thumb.jpg', 'u2/b/0.jpg']) });
  const db = new FakeSweepDatabase([{ id: 7, bucket: 'post-images', prefix: 'derived/u1' }]);
  const summary = await sweepDueIntents(db, storage, noReport);
  assertEquals(db.swept, [{ id: 7, found: 2, remaining: 0, error: null }]);
  assertEquals([...storage.files['post-images']], ['u2/b/0.jpg'], 'only the intent\'s folder is touched');
  assertEquals(summary, { verified: 1, pending: 0, failed: 0 });
});

Deno.test('a write that commits between the delete and the second listing keeps the intent open', async () => {
  const storage = new FakeStorage({ avatars: new Set(['u1/avatar-a.jpg']) });
  storage.afterRemove = () => storage.files.avatars.add('u1/avatar-late.jpg');
  const db = new FakeSweepDatabase([{ id: 8, bucket: 'avatars', prefix: 'u1' }]);
  const summary = await sweepDueIntents(db, storage, noReport);
  assertEquals(db.swept, [{ id: 8, found: 1, remaining: 1, error: null }]);
  assertEquals(summary, { verified: 0, pending: 1, failed: 0 });
  // The next run deletes the late object and closes the intent.
  const again = await sweepDueIntents(db, storage, noReport);
  assertEquals(db.swept.at(-1), { id: 8, found: 1, remaining: 0, error: null });
  assertEquals(again.verified, 1);
});

Deno.test('a failing intent is recorded with its error and reported; the others are still swept', async () => {
  const storage = new FakeStorage({ 'chat-media': new Set(['u1/c/a.jpg']), avatars: new Set(['u1/a.jpg']) });
  storage.failBucket = 'chat-media';
  const db = new FakeSweepDatabase([{ id: 1, bucket: 'chat-media', prefix: 'u1' }, { id: 2, bucket: 'avatars', prefix: 'u1' }]);
  const reported: number[] = [];
  const summary = await sweepDueIntents(db, storage, (_error, id) => { reported.push(id); return Promise.resolve(); });
  assertEquals(db.swept, [
    { id: 1, found: 0, remaining: 0, error: 'list HTTP 503' },
    { id: 2, found: 1, remaining: 0, error: null },
  ]);
  assertEquals(reported, [1]);
  assertEquals(summary, { verified: 1, pending: 0, failed: 1 });
});

Deno.test('every run prunes closed intents once, also when nothing is due', async () => {
  const db = new FakeSweepDatabase([]);
  assertEquals(await sweepDueIntents(db, new FakeStorage({}), noReport), { verified: 0, pending: 0, failed: 0 });
  assertEquals(db.pruned, 1);
});

Deno.test('Postgres adapter: one statement per method, each one database function', async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = createSweepDatabase((sql, params) => {
    calls.push({ sql, params });
    if (sql === SWEEP_SQL.dueIntents) return Promise.resolve([{ id: '3', bucket: 'avatars', prefix: 'u1' }]);
    if (sql === SWEEP_SQL.recordSweep) return Promise.resolve([{ answer: 'pending' }]);
    return Promise.resolve([{ pruned: 2 }]);
  });
  assertEquals(await db.dueIntents(10), [{ id: 3, bucket: 'avatars', prefix: 'u1' }]);
  assertEquals(await db.recordSweep(3, 1, 0, null), 'pending');
  assertEquals(await db.pruneIntents(), 2);
  assertEquals(calls.map((c) => c.params), [[10], [3, 1, 0, null], []]);
});
