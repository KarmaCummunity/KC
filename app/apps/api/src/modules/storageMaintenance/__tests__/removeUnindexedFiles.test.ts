import { describe, expect, it } from 'vitest';
import { MIN_AGE_MS, type OrphanFiles, type StoredFile } from '../reconcileStorage';
import { removeUnindexedFiles, type UnindexedDeps } from '../removeUnindexedFiles';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const old = (name: string): StoredFile => ({ name, createdAt: new Date(NOW - MIN_AGE_MS - 1) });
const fresh = (name: string): StoredFile => ({ name, createdAt: new Date(NOW - MIN_AGE_MS + 1) });

interface Setup {
  /** The stored files of each bucket, in listing order. */
  readonly files: Record<string, StoredFile[]>;
  /** The names the index has a row for, by bucket. */
  readonly indexed: Record<string, string[]>;
  readonly pageSize?: number;
  /** Replaces the listing or the removal, to make one fail. */
  readonly listPage?: OrphanFiles['listPage'];
  readonly remove?: OrphanFiles['remove'];
}

/** A store that lists `files` a page at a time, an index that knows `indexed`, and a record of what was done. */
function setup({ files, indexed, pageSize = 100, listPage, remove }: Setup) {
  const removed: Record<string, string[]> = {};
  const reported: Array<{ stage: string; bucket: string }> = [];
  /** A page of a bucket; the token is the position the next page starts at. */
  const pageOf: OrphanFiles['listPage'] = (bucket, _prefix, pageToken) => {
    const all = files[bucket] ?? [];
    const start = pageToken === undefined ? 0 : Number(pageToken);
    return Promise.resolve({ entries: all.slice(start, start + pageSize), nextPageToken: start + pageSize < all.length ? String(start + pageSize) : null });
  };
  const deps: UnindexedDeps = {
    files: {
      listPage: listPage ?? pageOf,
      remove: async (bucket, names) => {
        await remove?.(bucket, names);
        removed[bucket] = [...(removed[bucket] ?? []), ...names];
      },
    },
    index: {
      hasFiles: (bucket) => Promise.resolve((indexed[bucket] ?? []).length > 0),
      unindexed: (bucket, names) => Promise.resolve(names.filter((name) => !(indexed[bucket] ?? []).includes(name))),
    },
    report: (_error, tags) => reported.push(tags),
    now: () => NOW,
  };
  return { run: () => removeUnindexedFiles(deps, Object.keys(files)), pageOf, removed, reported };
}

describe('removeUnindexedFiles', () => {
  it('removes old files without a row, in every bucket; indexed and fresh files stay', async () => {
    const { run, removed } = setup({
      files: {
        avatars: [old('u1/deleted-at-the-source.jpg'), old('u1/kept.jpg'), fresh('u1/just-uploaded.jpg')],
        'chat-media': [old('u1/c1/kept.jpg'), old('u1/c1/never-confirmed.jpg')],
      },
      indexed: { avatars: ['u1/kept.jpg'], 'chat-media': ['u1/c1/kept.jpg'] },
    });

    const summary = await run();

    expect(summary).toEqual({ scanned: 4, removed: 2, errors: 0, skipped: [] });
    expect(removed).toEqual({ avatars: ['u1/deleted-at-the-source.jpg'], 'chat-media': ['u1/c1/never-confirmed.jpg'] });
  });

  it('judges every page of a bucket', async () => {
    const { run, removed } = setup({
      files: { avatars: [old('a.jpg'), old('b.jpg'), old('c.jpg'), old('d.jpg'), old('e.jpg')] },
      indexed: { avatars: ['a.jpg', 'c.jpg'] },
      pageSize: 2,
    });

    expect(await run()).toEqual({ scanned: 5, removed: 3, errors: 0, skipped: [] });
    expect(removed).toEqual({ avatars: ['b.jpg', 'd.jpg', 'e.jpg'] });
  });

  it('touches nothing in a bucket whose index is empty, and names the bucket', async () => {
    const { run, removed } = setup({
      files: { avatars: [old('u1/a.jpg'), old('u2/b.jpg')], 'post-images': [old('u1/p.jpg'), old('u1/orphan.jpg')] },
      indexed: { 'post-images': ['u1/p.jpg'] },
    });

    const summary = await run();

    expect(summary).toEqual({ scanned: 2, removed: 1, errors: 0, skipped: ['avatars'] });
    expect(removed).toEqual({ 'post-images': ['u1/orphan.jpg'] });
  });

  it('ends a bucket whose listing fails, reports it, and goes on with the next bucket', async () => {
    const base = setup({ files: { avatars: [old('a.jpg')], 'post-images': [old('p.jpg'), old('q.jpg')] }, indexed: { avatars: ['x.jpg'], 'post-images': ['p.jpg'] } });
    const { run, removed, reported } = setup({
      files: { avatars: [old('a.jpg')], 'post-images': [old('p.jpg'), old('q.jpg')] },
      indexed: { avatars: ['x.jpg'], 'post-images': ['p.jpg'] },
      listPage: (bucket, prefix, pageToken) => (bucket === 'avatars' ? Promise.reject(new Error('listing failed')) : base.pageOf(bucket, prefix, pageToken)),
    });

    expect(await run()).toEqual({ scanned: 2, removed: 1, errors: 1, skipped: [] });
    expect(reported).toEqual([{ stage: 'scan', bucket: 'avatars' }]);
    expect(removed).toEqual({ 'post-images': ['q.jpg'] });
  });

  it('counts a page that could not be removed and goes on with the pages after it', async () => {
    let calls = 0;
    const { run, removed, reported } = setup({
      files: { avatars: [old('a.jpg'), old('b.jpg'), old('c.jpg'), old('d.jpg')] },
      indexed: { avatars: ['kept.jpg'] },
      pageSize: 2,
      remove: () => ((calls += 1) === 1 ? Promise.reject(new Error('store unavailable')) : Promise.resolve()),
    });

    expect(await run()).toEqual({ scanned: 4, removed: 2, errors: 2, skipped: [] });
    expect(reported).toEqual([{ stage: 'remove', bucket: 'avatars' }]);
    expect(removed).toEqual({ avatars: ['c.jpg', 'd.jpg'] });
  });
});
