// purge-deleted-accounts against in-memory fakes of its two ports.
// Run: deno test --allow-read purge-deleted-accounts   (from supabase/functions)
import { assertEquals } from 'jsr:@std/assert@1';
import type { StorageListEntry } from '../_shared/storageCleanup.ts';
import { createPurgeDatabase, createPurgeHandler, PURGE_SQL, type PurgeDatabase, type PurgeStorage } from './handler.ts';
import { SWEEP_SQL, type DeletionIntent, type SweepAnswer } from './sweep.ts';

/** The sweep summary of a run with no due deletion intent. */
const NO_INTENTS = { verified: 0, pending: 0, failed: 0 };

const KEY = 'service-key-for-tests';
const post = (key = KEY) => new Request('https://x/functions/v1/purge-deleted-accounts', { method: 'POST', headers: { Authorization: `Bearer ${key}` } });

/** The database functions of the purge, with the order of calls recorded. */
class FakeDatabase implements PurgeDatabase {
  readonly log: string[] = [];
  readonly tombstones = new Set<string>();
  failOn: Record<string, string> = {};
  /** Members with a photo job still holding a lease (a worker may still write for them). */
  readonly inFlight = new Set<string>();
  /** Open storage deletion intents (written by `finish` in the database). */
  intents: DeletionIntent[] = [];
  failDueIntents = false;
  constructor(readonly due: string[]) {}
  dueIntents(limit: number) {
    if (this.failDueIntents) return Promise.reject(new Error('db down'));
    return Promise.resolve(this.intents.slice(0, limit));
  }
  recordSweep(id: number, _found: number, remaining: number, error: string | null): Promise<SweepAnswer> {
    this.log.push(`swept:${id}:${error ?? remaining}`);
    if (!error && remaining === 0) this.intents = this.intents.filter((i) => i.id !== id);
    return Promise.resolve(error ? 'retry' : remaining === 0 ? 'verified' : 'pending');
  }
  pruneIntents() {
    return Promise.resolve(0);
  }
  dueAccounts(limit: number) {
    return Promise.resolve(this.due.slice(0, limit));
  }
  prepare(userId: string) {
    this.log.push(`prepare:${userId}`);
    if (this.failOn[userId] === 'prepare') return Promise.reject(new Error('db down'));
    this.tombstones.add(userId);
    return Promise.resolve();
  }
  holdForMedia(userId: string) {
    this.log.push(`hold:${userId}`);
    return Promise.resolve(this.inFlight.has(userId));
  }
  finish(userId: string) {
    this.log.push(`finish:${userId}`);
    if (this.failOn[userId] === 'finish') return Promise.reject(new Error('db down'));
    const at = this.due.indexOf(userId);
    if (at >= 0) this.due.splice(at, 1);
    return Promise.resolve(at >= 0);
  }
}

/** Buckets of `path → true`; folders are derived from the paths, as in Storage. */
class FakeStorage implements PurgeStorage {
  failBucket: string | null = null;
  constructor(readonly files: Record<string, Set<string>>, readonly log: string[]) {}
  buckets() {
    return Promise.resolve(Object.keys(this.files));
  }
  list(bucket: string, prefix: string, offset: number, limit: number) {
    if (bucket === this.failBucket) return Promise.reject(new Error('storage down'));
    const children = new Map<string, StorageListEntry>();
    for (const path of this.files[bucket]) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const [name, ...rest] = path.slice(prefix.length + 1).split('/');
      children.set(name, { name, id: rest.length > 0 ? null : 'object-id' });
    }
    return Promise.resolve([...children.values()].slice(offset, offset + limit));
  }
  remove(bucket: string, paths: string[]) {
    this.log.push(`remove:${bucket}:${paths.length}`);
    for (const path of paths) this.files[bucket].delete(path);
    return Promise.resolve();
  }
}

function setup(due: string[]) {
  const db = new FakeDatabase(due);
  const storage = new FakeStorage({
    avatars: new Set(['u1/avatar.jpg', 'u2/avatar.jpg', 'u3/avatar.jpg']),
    'chat-media': new Set(['u1/chat-1/a.jpg', 'u1/chat-2/b.jpg', 'u3/chat-1/c.jpg']),
    'post-images': new Set(['u2/batch/1.jpg']),
  }, db.log);
  const reports: string[] = [];
  const handler = createPurgeHandler({
    db, storage, serviceRoleKey: KEY,
    report: (_error, tags) => { reports.push(`${tags.stage}:${tags.user_id ?? '-'}`); return Promise.resolve(); },
  });
  return { db, storage, reports, handler };
}

Deno.test('only the service role may start the purge, and nothing is read before the check', async () => {
  const { db, handler } = setup(['u1']);
  assertEquals((await handler(post('anon-key'))).status, 401);
  assertEquals((await handler(new Request('https://x', { method: 'GET' }))).status, 405);
  assertEquals(db.log, []);
});

Deno.test('each due account: tombstone and billing first, then its files, then the identity', async () => {
  const { db, storage, handler } = setup(['u1', 'u2']);
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 2, failed: 0, deferred: 0, intents: NO_INTENTS });
  assertEquals(db.log, [
    'prepare:u1', 'hold:u1', 'remove:avatars:1', 'remove:chat-media:2', 'finish:u1',
    'prepare:u2', 'hold:u2', 'remove:avatars:1', 'remove:post-images:1', 'finish:u2',
  ]);
  assertEquals([...storage.files.avatars], ['u3/avatar.jpg'], 'another member\'s files are untouched');
  assertEquals([...storage.files['chat-media']], ['u3/chat-1/c.jpg']);
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 0, failed: 0, deferred: 0, intents: NO_INTENTS }, 'a second run has nothing to do');
});

Deno.test('a failing account is reported, keeps its identity and does not block the others; the next run finishes it', async () => {
  const { db, storage, reports, handler } = setup(['u1', 'u2', 'u3']);
  db.failOn = { u1: 'prepare', u3: 'finish' };
  storage.failBucket = null;
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 1, failed: 2, deferred: 0, intents: NO_INTENTS });
  assertEquals(reports, ['prepare:u1', 'finish:u3']);
  assertEquals(db.due, ['u1', 'u3'], 'both stay due');
  assertEquals(db.log.filter((l) => l.endsWith(':u1')), ['prepare:u1'], 'no file is touched before the tombstone exists');

  db.failOn = {};
  storage.failBucket = 'chat-media';
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 0, failed: 2, deferred: 0, intents: NO_INTENTS });
  assertEquals(reports.slice(2), ['storage:u1', 'storage:u3']);
  assertEquals(db.log.filter((l) => l.startsWith('finish')).length, 2, 'the identity is not deleted while files remain');

  storage.failBucket = null;
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 2, failed: 0, deferred: 0, intents: NO_INTENTS }, 'the purge is resumable');
  assertEquals([db.due, [...db.tombstones].sort()], [[], ['u1', 'u2', 'u3']]);
  assertEquals(Object.values(storage.files).map((s) => s.size), [0, 0, 0]);
});

Deno.test('the server-made photo copies under derived/<user_id>/ go with the member\'s own folder, before the identity', async () => {
  const db = new FakeDatabase(['u2']);
  const storage = new FakeStorage({
    'post-images': new Set(['u2/batch/1.jpg', 'derived/u2/m1-a1.jpg', 'derived/u2/m1-a1-thumb.jpg', 'derived/u3/m9-a1.jpg', 'derived/u22/m5-a1.jpg']),
    avatars: new Set(['derived/u2/not-a-copy.jpg']),
  }, db.log);
  const handler = createPurgeHandler({ db, storage, serviceRoleKey: KEY, report: () => Promise.resolve() });
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 1, failed: 0, deferred: 0, intents: NO_INTENTS });
  assertEquals([...storage.files['post-images']].sort(), ['derived/u22/m5-a1.jpg', 'derived/u3/m9-a1.jpg'],
    'every copy of u2 is gone; other members\' copies (even with a u2 prefix in their id) stay');
  assertEquals([...storage.files.avatars], ['derived/u2/not-a-copy.jpg'], 'the copy namespace exists in post-images only');
  assertEquals(db.log, ['prepare:u2', 'hold:u2', 'remove:post-images:1', 'remove:post-images:2', 'finish:u2']);
});

Deno.test('an account with a photo job still holding a lease is deferred: no file is touched, the identity stays, the next run purges it', async () => {
  const db = new FakeDatabase(['u2']);
  const storage = new FakeStorage({ 'post-images': new Set(['u2/batch/1.jpg', 'derived/u2/m1-a1.jpg']) }, db.log);
  const reports: string[] = [];
  const handler = createPurgeHandler({ db, storage, serviceRoleKey: KEY, report: (_e, tags) => { reports.push(String(tags.stage)); return Promise.resolve(); } });
  db.inFlight.add('u2');
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 0, failed: 0, deferred: 1, intents: NO_INTENTS });
  assertEquals(db.log, ['prepare:u2', 'hold:u2'], 'the hold is asked after the tombstone and before any file is removed');
  assertEquals(storage.files['post-images'].size, 2);
  assertEquals(db.due, ['u2']);
  assertEquals(reports, [], 'a deferral is not an error');
  db.inFlight.delete('u2'); // the lease ran out (the cancelled job can no longer write)
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 1, failed: 0, deferred: 0, intents: NO_INTENTS });
  assertEquals(storage.files['post-images'].size, 0);
});

Deno.test('a failure to list the due accounts is a 500 and is reported', async () => {
  const { db, reports, handler } = setup([]);
  db.dueAccounts = () => Promise.reject(new Error('db down'));
  assertEquals((await handler(post())).status, 500);
  assertEquals(reports, ['list_due:-']);
});

Deno.test('Postgres adapter: one statement per method, each one database function', async () => {
  const calls: [string, unknown[]][] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    [PURGE_SQL.dueAccounts]: [{ user_id: 'u1' }, { user_id: 'u2' }],
    [PURGE_SQL.prepare]: [{}],
    [PURGE_SQL.holdForMedia]: [{ held: true }],
    [PURGE_SQL.finish]: [{ finished: true }],
  };
  const db = createPurgeDatabase((sql, params) => { calls.push([sql, params]); return Promise.resolve(rows[sql]); });
  assertEquals(await db.dueAccounts(50), ['u1', 'u2']);
  await db.prepare('u1');
  assertEquals(await db.holdForMedia('u1'), true);
  assertEquals(await db.finish('u1'), true);
  assertEquals(calls.map(([, params]) => params), [[50], ['u1'], ['u1'], ['u1']]);
  for (const sql of [...Object.values(PURGE_SQL), ...Object.values(SWEEP_SQL)]) assertEquals(sql.match(/kc_private\.\w+/g)?.length, 1, sql);
});

Deno.test('after the accounts, the run re-sweeps due deletion intents: a late object is removed and the intent closes', async () => {
  const { db, storage, handler } = setup([]);
  storage.files['post-images'].add('derived/u9/m-a1.jpg'); // landed after u9's purge
  db.intents = [{ id: 4, bucket: 'post-images', prefix: 'derived/u9' }];
  assertEquals(await (await handler(post())).json(),
    { ok: true, purged: 0, failed: 0, deferred: 0, intents: { verified: 1, pending: 0, failed: 0 } });
  assertEquals(storage.files['post-images'].has('derived/u9/m-a1.jpg'), false);
  assertEquals(db.log.at(-1), 'swept:4:0');
});

Deno.test('a failure to read the deletion intents is reported but does not undo the accounts purged in the run', async () => {
  const { db, reports, handler } = setup(['u1']);
  db.failDueIntents = true;
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 1, failed: 0, deferred: 0, intents: null });
  assertEquals(reports, ['sweep:-']);
});
