// reconcile-storage-orphans against in-memory fakes of its two ports.
// Run: deno test --allow-read reconcile-storage-orphans   (from supabase/functions)
import { assertEquals } from 'jsr:@std/assert@1';
import {
  createOrphanDatabase, createOrphanHandler, type ObjectEntry, ORPHAN_SQL, type OrphanDatabase, type OrphanStorage,
} from './handler.ts';

const KEY = 'service-key-for-tests';
const NOW = Date.parse('2026-11-10T12:00:00Z');
const OLD = '2026-11-01T00:00:00Z';
const FRESH = '2026-11-10T11:00:00Z';
const post = (key = KEY) => new Request('https://x/functions/v1/reconcile-storage-orphans', { method: 'POST', headers: { Authorization: `Bearer ${key}` } });

/** One bucket: path → creation time (null = unknown). */
class FakeStorage implements OrphanStorage {
  readonly removed: string[][] = [];
  failList = false;
  failRemove = false;
  constructor(readonly files: Map<string, string | null>) {}
  list(_bucket: string, prefix: string, offset: number, limit: number) {
    if (this.failList && prefix !== '') return Promise.reject(new Error('storage down'));
    const children = new Map<string, ObjectEntry>();
    for (const [path, createdAt] of this.files) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      const [name, ...rest] = (prefix ? path.slice(prefix.length + 1) : path).split('/');
      children.set(name, rest.length > 0 ? { name, id: null } : { name, id: 'object-id', created_at: createdAt });
    }
    return Promise.resolve([...children.values()].slice(offset, offset + limit));
  }
  remove(_bucket: string, paths: string[]) {
    if (this.failRemove) return Promise.reject(new Error('storage down'));
    this.removed.push(paths);
    for (const path of paths) this.files.delete(path);
    return Promise.resolve();
  }
}

function setup(files: [string, string | null][], referenced: string[]) {
  const storage = new FakeStorage(new Map(files));
  const asked: string[][] = [];
  const db: OrphanDatabase = {
    orphanKeys(_bucket, keys) {
      asked.push(keys);
      return Promise.resolve(keys.filter((key) => !referenced.includes(key)));
    },
  };
  const reports: string[] = [];
  const handler = createOrphanHandler({
    db, storage, serviceRoleKey: KEY, now: () => NOW,
    report: (_error, tags) => { reports.push(`${tags.stage}:${tags.bucket}`); return Promise.resolve(); },
  });
  return { storage, asked, reports, handler };
}

Deno.test('only the service role may start the reconciliation', async () => {
  const { asked, handler } = setup([['u1/b/1.jpg', OLD]], []);
  assertEquals((await handler(post('anon-key'))).status, 401);
  assertEquals((await handler(new Request('https://x', { method: 'GET' }))).status, 405);
  assertEquals(asked, []);
});

Deno.test('old unreferenced files are removed; referenced, fresh and undated files stay', async () => {
  const { storage, asked, handler } = setup([
    ['u1/b/kept.jpg', OLD], ['u1/b/orphan.jpg', OLD], ['u2/c/orphan.jpg', OLD],
    ['u2/c/just-uploaded.jpg', FRESH], ['u2/c/undated.jpg', null],
  ], ['u1/b/kept.jpg']);
  assertEquals(await (await handler(post())).json(), { ok: true, scanned: 3, removed: 2, errors: 0 });
  assertEquals(asked, [['u1/b/kept.jpg', 'u1/b/orphan.jpg', 'u2/c/orphan.jpg']], 'only old files are judged, in one question');
  assertEquals([...storage.files.keys()], ['u1/b/kept.jpg', 'u2/c/just-uploaded.jpg', 'u2/c/undated.jpg']);
  assertEquals(await (await handler(post())).json(), { ok: true, scanned: 1, removed: 0, errors: 0 }, 'a second run removes nothing');
});

Deno.test('a large bucket is paged, asked and removed in batches', async () => {
  const files = Array.from({ length: 1234 }, (_, i): [string, string] => [`u1/b/${String(i).padStart(4, '0')}.jpg`, OLD]);
  const { storage, asked, handler } = setup(files, []);
  assertEquals(await (await handler(post())).json(), { ok: true, scanned: 1234, removed: 1234, errors: 0 });
  assertEquals(asked.map((keys) => keys.length), [500, 500, 234]);
  assertEquals([storage.removed.length, Math.max(...storage.removed.map((p) => p.length))], [13, 100]);
});

Deno.test('a bucket that cannot be listed completely is not cleaned; a failed removal is counted', async () => {
  const listing = setup([['u1/b/orphan.jpg', OLD]], []);
  listing.storage.failList = true;
  assertEquals(await (await listing.handler(post())).json(), { ok: true, scanned: 0, removed: 0, errors: 1 });
  assertEquals([listing.reports, listing.storage.files.size], [['scan:post-images'], 1]);

  const removing = setup([['u1/b/orphan.jpg', OLD], ['u1/b/other.jpg', OLD]], []);
  removing.storage.failRemove = true;
  assertEquals(await (await removing.handler(post())).json(), { ok: true, scanned: 2, removed: 0, errors: 2 });
  assertEquals(removing.reports, ['remove:post-images']);
});

Deno.test('Postgres adapter: one statement, one database function; no question for no keys', async () => {
  const calls: unknown[][] = [];
  const db = createOrphanDatabase((sql, params) => {
    calls.push([sql, ...params]);
    return Promise.resolve([{ key: 'a/b.jpg' }]);
  });
  assertEquals(await db.orphanKeys('post-images', []), []);
  assertEquals(await db.orphanKeys('post-images', ['a/b.jpg', 'c/d.jpg']), ['a/b.jpg']);
  assertEquals(calls, [[ORPHAN_SQL, 'post-images', ['a/b.jpg', 'c/d.jpg']]]);
  assertEquals(ORPHAN_SQL.match(/kc_private\.\w+/g), ['kc_private.storage_orphan_keys']);
});
