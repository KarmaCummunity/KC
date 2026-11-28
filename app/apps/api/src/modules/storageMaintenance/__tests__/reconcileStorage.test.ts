import { describe, expect, it } from 'vitest';
import { MIN_AGE_MS, type OrphanFiles, reconcileStorage, type ReconcileDeps, type StoredFile } from '../reconcileStorage';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const old = (name: string): StoredFile => ({ name, createdAt: new Date(NOW - MIN_AGE_MS - 1) });
const fresh = (name: string): StoredFile => ({ name, createdAt: new Date(NOW - MIN_AGE_MS + 1) });

interface Setup {
  /** The stored files of each bucket, in listing order. */
  readonly files: Record<string, StoredFile[]>;
  /** Keys a database row references. */
  readonly referenced?: string[];
  readonly pageSize?: number;
  readonly buckets?: readonly string[];
  /** Replaces the listing or the removal, to make one fail. */
  readonly listPage?: OrphanFiles['listPage'];
  readonly remove?: OrphanFiles['remove'];
}

/** A store that lists `files` a page at a time, a database that knows `referenced`, and a record of what was done. */
function setup({ files, referenced = [], pageSize = 100, buckets, listPage, remove }: Setup) {
  const removed: Array<{ bucket: string; names: string[] }> = [];
  const asked: Array<{ bucket: string; keys: string[] }> = [];
  const reported: Array<{ stage: string; bucket: string }> = [];
  /** A page of a bucket; the token is the index the next page starts at. */
  const pageOf: OrphanFiles['listPage'] = (bucket, _prefix, pageToken) => {
    const all = files[bucket] ?? [];
    const start = pageToken === undefined ? 0 : Number(pageToken);
    return Promise.resolve({ entries: all.slice(start, start + pageSize), nextPageToken: start + pageSize < all.length ? String(start + pageSize) : null });
  };
  const deps: ReconcileDeps = {
    files: {
      listPage: listPage ?? pageOf,
      remove: async (bucket, names) => {
        await remove?.(bucket, names);
        removed.push({ bucket, names: [...names] });
      },
    },
    db: {
      orphanKeys: (bucket, keys) => {
        asked.push({ bucket, keys: [...keys] });
        return Promise.resolve(keys.filter((key) => !referenced.includes(key)));
      },
    },
    report: (_error, tags) => reported.push(tags),
    now: () => NOW,
    ...(buckets ? { buckets } : {}),
  };
  return { run: () => reconcileStorage(deps), pageOf, removed, asked, reported };
}

describe('reconcileStorage', () => {
  it('removes old unreferenced files; referenced and fresh files stay', async () => {
    const { run, removed, asked } = setup({
      files: { 'post-images': [old('u1/a.jpg'), old('u1/kept.jpg'), fresh('u1/new.jpg'), old('u2/b.jpg')] },
      referenced: ['u1/kept.jpg'],
    });

    const summary = await run();

    expect(summary).toEqual({ scanned: 3, removed: 2, errors: 0 });
    expect(removed).toEqual([{ bucket: 'post-images', names: ['u1/a.jpg', 'u2/b.jpg'] }]);
    // A fresh upload is not even asked about: its row may not be written yet.
    expect(asked).toEqual([{ bucket: 'post-images', keys: ['u1/a.jpg', 'u1/kept.jpg', 'u2/b.jpg'] }]);
  });

  it('works through a large bucket a page at a time: each page is asked and removed on its own', async () => {
    const files = Array.from({ length: 250 }, (_unused, index) => old(`u1/${String(index).padStart(3, '0')}.jpg`));
    const { run, removed, asked } = setup({ files: { 'post-images': files }, pageSize: 100 });

    const summary = await run();

    expect(summary).toEqual({ scanned: 250, removed: 250, errors: 0 });
    expect(asked.map((question) => question.keys.length)).toEqual([100, 100, 50]);
    expect(removed.map((removal) => removal.names.length)).toEqual([100, 100, 50]);
  });

  it('does not ask the database about a page with nothing old on it', async () => {
    const { run, asked, removed } = setup({ files: { 'post-images': [fresh('u1/a.jpg'), fresh('u1/b.jpg')] } });

    expect(await run()).toEqual({ scanned: 0, removed: 0, errors: 0 });
    expect([asked, removed]).toEqual([[], []]);
  });

  it('ends a bucket at a page that cannot be listed, keeps what was done, and goes on to the next bucket', async () => {
    const files = { first: [old('x/1.jpg'), old('x/2.jpg')], second: [old('y/1.jpg')] };
    const context = setup({
      files,
      pageSize: 1,
      buckets: ['first', 'second'],
      // The second page of the first bucket cannot be listed.
      listPage: (bucket, prefix, pageToken) => (bucket === 'first' && pageToken !== undefined ? Promise.reject(new Error('listing timed out')) : context.pageOf(bucket, prefix, pageToken)),
    });

    const summary = await context.run();

    expect(summary).toEqual({ scanned: 2, removed: 2, errors: 1 });
    expect(context.removed).toEqual([{ bucket: 'first', names: ['x/1.jpg'] }, { bucket: 'second', names: ['y/1.jpg'] }]);
    expect(context.reported).toEqual([{ stage: 'scan', bucket: 'first' }]);
  });

  it('counts a failed removal per file, reports it, and still finishes the listing', async () => {
    let removals = 0;
    const { run, removed, reported } = setup({
      files: { 'post-images': [old('u1/a.jpg'), old('u1/b.jpg'), old('u1/c.jpg')] },
      pageSize: 2,
      // The first page's removal fails; the second page's succeeds.
      remove: () => (++removals === 1 ? Promise.reject(new Error('store unavailable')) : Promise.resolve()),
    });

    const summary = await run();

    expect(summary).toEqual({ scanned: 3, removed: 1, errors: 2 });
    expect(removed).toEqual([{ bucket: 'post-images', names: ['u1/c.jpg'] }]);
    expect(reported).toEqual([{ stage: 'remove', bucket: 'post-images' }]);
  });

  it('judges only the buckets that are recorded row by row, by default post-images', async () => {
    const { run, asked } = setup({
      files: { 'post-images': [old('u1/a.jpg')], avatars: [old('u1/avatar.jpg')], 'chat-media': [old('u1/c/x.jpg')] },
      referenced: ['u1/a.jpg'],
    });

    await run();

    expect(asked.map((question) => question.bucket)).toEqual(['post-images']);
  });
});
