// purge-deleted-accounts against in-memory fakes of its two ports.
// Run: deno test --allow-read purge-deleted-accounts   (from supabase/functions)
import { assertEquals } from 'jsr:@std/assert@1';
import type { StorageListEntry } from '../_shared/storageCleanup.ts';
import { createPurgeDatabase, createPurgeHandler, PURGE_SQL, type PurgeDatabase, type PurgeStorage } from './handler.ts';

const KEY = 'service-key-for-tests';
const post = (key = KEY) => new Request('https://x/functions/v1/purge-deleted-accounts', { method: 'POST', headers: { Authorization: `Bearer ${key}` } });

/** The database functions of the purge, with the order of calls recorded. */
class FakeDatabase implements PurgeDatabase {
  readonly log: string[] = [];
  readonly tombstones = new Set<string>();
  failOn: Record<string, string> = {};
  constructor(readonly due: string[]) {}
  dueAccounts(limit: number) {
    return Promise.resolve(this.due.slice(0, limit));
  }
  prepare(userId: string) {
    this.log.push(`prepare:${userId}`);
    if (this.failOn[userId] === 'prepare') return Promise.reject(new Error('db down'));
    this.tombstones.add(userId);
    return Promise.resolve();
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
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 2, failed: 0 });
  assertEquals(db.log, [
    'prepare:u1', 'remove:avatars:1', 'remove:chat-media:2', 'finish:u1',
    'prepare:u2', 'remove:avatars:1', 'remove:post-images:1', 'finish:u2',
  ]);
  assertEquals([...storage.files.avatars], ['u3/avatar.jpg'], 'another member\'s files are untouched');
  assertEquals([...storage.files['chat-media']], ['u3/chat-1/c.jpg']);
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 0, failed: 0 }, 'a second run has nothing to do');
});

Deno.test('a failing account is reported, keeps its identity and does not block the others; the next run finishes it', async () => {
  const { db, storage, reports, handler } = setup(['u1', 'u2', 'u3']);
  db.failOn = { u1: 'prepare', u3: 'finish' };
  storage.failBucket = null;
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 1, failed: 2 });
  assertEquals(reports, ['prepare:u1', 'finish:u3']);
  assertEquals(db.due, ['u1', 'u3'], 'both stay due');
  assertEquals(db.log.filter((l) => l.endsWith(':u1')), ['prepare:u1'], 'no file is touched before the tombstone exists');

  db.failOn = {};
  storage.failBucket = 'chat-media';
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 0, failed: 2 });
  assertEquals(reports.slice(2), ['storage:u1', 'storage:u3']);
  assertEquals(db.log.filter((l) => l.startsWith('finish')).length, 2, 'the identity is not deleted while files remain');

  storage.failBucket = null;
  assertEquals(await (await handler(post())).json(), { ok: true, purged: 2, failed: 0 }, 'the purge is resumable');
  assertEquals([db.due, [...db.tombstones].sort()], [[], ['u1', 'u2', 'u3']]);
  assertEquals(Object.values(storage.files).map((s) => s.size), [0, 0, 0]);
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
    [PURGE_SQL.finish]: [{ finished: true }],
  };
  const db = createPurgeDatabase((sql, params) => { calls.push([sql, params]); return Promise.resolve(rows[sql]); });
  assertEquals(await db.dueAccounts(50), ['u1', 'u2']);
  await db.prepare('u1');
  assertEquals(await db.finish('u1'), true);
  assertEquals(calls.map(([, params]) => params), [[50], ['u1'], ['u1']]);
  for (const sql of Object.values(PURGE_SQL)) assertEquals(sql.match(/kc_private\.\w+/g)?.length, 1, sql);
});
