// _shared/storageCleanup.test.ts — run: deno test supabase/functions/_shared
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  chunkPaths,
  collectObjectPaths,
  LIST_PAGE_SIZE,
  purgeUserFolders,
  type StorageGateway,
  type StorageListEntry,
} from './storageCleanup.ts';

/** In-memory bucket: maps a folder prefix to its direct children. */
function fakeBucket(tree: Record<string, StorageListEntry[]>) {
  const calls: string[] = [];
  const listPage = (prefix: string, offset: number, limit: number) => {
    calls.push(`${prefix}@${offset}`);
    return Promise.resolve((tree[prefix] ?? []).slice(offset, offset + limit));
  };
  return { listPage, calls };
}

const file = (name: string): StorageListEntry => ({ name, id: `id-${name}` });
const folder = (name: string): StorageListEntry => ({ name, id: null });

Deno.test('collects files in nested folders under the user prefix', async () => {
  const { listPage } = fakeBucket({
    u1: [folder('chatA'), folder('chatB'), file('root.jpg')],
    'u1/chatA': [file('a1.jpg'), file('a2.jpg')],
    'u1/chatB': [file('b1.jpg')],
  });

  const paths = await collectObjectPaths(listPage, 'u1');

  assertEquals(paths.sort(), ['u1/chatA/a1.jpg', 'u1/chatA/a2.jpg', 'u1/chatB/b1.jpg', 'u1/root.jpg']);
});

Deno.test('pages through a folder larger than one page', async () => {
  const many = Array.from({ length: LIST_PAGE_SIZE + 5 }, (_, i) => file(`f${i}.jpg`));
  const { listPage, calls } = fakeBucket({ u1: many });

  const paths = await collectObjectPaths(listPage, 'u1');

  assertEquals(paths.length, LIST_PAGE_SIZE + 5);
  assertEquals(calls, ['u1@0', `u1@${LIST_PAGE_SIZE}`]);
});

Deno.test('returns nothing for a user with no objects', async () => {
  const { listPage } = fakeBucket({});
  assertEquals(await collectObjectPaths(listPage, 'nobody'), []);
});

Deno.test('stops descending at the depth limit', async () => {
  const { listPage } = fakeBucket({
    u1: [folder('a')],
    'u1/a': [folder('b')],
    'u1/a/b': [folder('c')],
    'u1/a/b/c': [file('too-deep.jpg')],
  });
  assertEquals(await collectObjectPaths(listPage, 'u1', 3), []);
});

Deno.test('chunks paths for the remove API', () => {
  assertEquals(chunkPaths(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assertEquals(chunkPaths([], 2), []);
});

/**
 * In-memory Storage holding full object paths per bucket. `list` returns the direct
 * children of a prefix the way Supabase Storage does: folders carry `id: null`.
 */
function fakeStorage(objects: Record<string, string[]>, failing: { list?: string; remove?: string } = {}) {
  const buckets = new Map(Object.entries(objects).map(([bucket, paths]) => [bucket, new Set(paths)]));
  const gateway: StorageGateway = {
    list(bucket, prefix, offset, limit) {
      if (bucket === failing.list) return Promise.reject(new Error(`list failed: ${bucket}`));
      const children = new Map<string, StorageListEntry>();
      for (const path of buckets.get(bucket) ?? []) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const [name, ...rest] = path.slice(prefix.length + 1).split('/');
        children.set(name, { name, id: rest.length > 0 ? null : `id-${path}` });
      }
      return Promise.resolve([...children.values()].slice(offset, offset + limit));
    },
    remove(bucket, paths) {
      if (bucket === failing.remove) return Promise.reject(new Error(`remove failed: ${bucket}`));
      for (const path of paths) buckets.get(bucket)?.delete(path);
      return Promise.resolve();
    },
  };
  const remaining = (bucket: string) => [...(buckets.get(bucket) ?? [])].sort();
  return { gateway, remaining };
}

Deno.test('purges every object the user owns in every user-folder bucket, and nothing of another user', async () => {
  const { gateway, remaining } = fakeStorage({
    'avatars': ['u1/avatar.jpg', 'u1/avatar-thumb.jpg', 'u2/avatar.jpg'],
    'post-images': ['u1/batch1/0.jpg', 'u1/batch1/0-thumb.jpg', 'u1/draft/0.jpg', 'u2/batch9/0.jpg'],
    'chat-media': ['u1/chatA/m1.jpg', 'u2/chatA/m2.jpg'],
    'listing-images': ['u1/batch2/0.jpg', 'u2/batch3/0.jpg'],
  });
  const errors: string[] = [];

  await purgeUserFolders(gateway, 'u1', (_error, bucket) => {
    errors.push(bucket);
    return Promise.resolve();
  });

  assertEquals(errors, []);
  assertEquals(remaining('avatars'), ['u2/avatar.jpg']);
  assertEquals(remaining('post-images'), ['u2/batch9/0.jpg']);
  assertEquals(remaining('chat-media'), ['u2/chatA/m2.jpg']);
  assertEquals(remaining('listing-images'), ['u2/batch3/0.jpg']);
});

Deno.test('a bucket that fails is reported and the other buckets are still purged', async () => {
  const { gateway, remaining } = fakeStorage(
    {
      'avatars': ['u1/avatar.jpg'],
      'post-images': ['u1/batch1/0.jpg'],
      'chat-media': ['u1/chatA/m1.jpg'],
      'listing-images': ['u1/batch2/0.jpg'],
    },
    { list: 'chat-media', remove: 'listing-images' },
  );
  const errors: string[] = [];

  await purgeUserFolders(gateway, 'u1', (_error, bucket) => {
    errors.push(bucket);
    return Promise.resolve();
  });

  assertEquals(errors.sort(), ['chat-media', 'listing-images']);
  assertEquals(remaining('avatars'), []);
  assertEquals(remaining('post-images'), []);
});
