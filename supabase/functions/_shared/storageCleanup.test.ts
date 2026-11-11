// _shared/storageCleanup.test.ts — run: deno test supabase/functions/_shared
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  chunkPaths,
  collectObjectPaths,
  LIST_PAGE_SIZE,
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
