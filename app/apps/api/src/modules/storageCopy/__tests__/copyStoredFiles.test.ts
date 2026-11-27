import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalObjectStore } from '../../../platform/storage/localObjectStore';
import { type CopyCursor, type CopyDeps, CopyNameTakenError, CopyNotProvenError, CopySourceAccessError, copyStoredFiles, type CopySummary, type IndexedFile } from '../copyStoredFiles';

const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));
const NOTHING_DONE = { verified: 0, copied: 0, replaced: 0, destinationOnly: 0, absent: 0, failed: 0 };

/** One file of the source, and how its row describes it. */
interface SourceFile {
  readonly bytes: Uint8Array;
  /** False for a row that records no checksum, as for a file that was sent in parts. */
  readonly checksumRecorded?: boolean;
  readonly contentType?: string;
  readonly cacheControl?: string | null;
}

describe('copyStoredFiles', () => {
  let directory: string;
  let destination: LocalObjectStore;
  /** The source's files by bucket and name; the index describes exactly these, plus `rowsOnly`. */
  let source: Record<string, Record<string, SourceFile>>;
  /** Rows of the index whose file the source does not have, by bucket. */
  let rowsOnly: Record<string, string[]>;
  let downloads: string[];
  let reported: Array<{ bucket: string; name: string; problem: unknown }>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-copy-'));
    destination = new LocalObjectStore({ directory, baseUrl: 'http://api.kc.test', signingSecret: 'copy-secret' });
    source = {};
    rowsOnly = {};
    downloads = [];
    reported = [];
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const rowOf = (name: string, file: SourceFile | undefined): IndexedFile => ({
    name,
    size: file ? file.bytes.byteLength : null,
    contentType: file?.contentType ?? 'image/jpeg',
    cacheControl: file?.cacheControl ?? null,
    md5: file && file.checksumRecorded !== false ? md5(file.bytes) : null,
  });

  const deps = (overrides: Partial<CopyDeps> = {}): CopyDeps => ({
    index: {
      page: (bucket, after, limit) => {
        const names = [...Object.keys(source[bucket] ?? {}), ...(rowsOnly[bucket] ?? [])].sort();
        return Promise.resolve(names.filter((name) => after === null || name > after).slice(0, limit).map((name) => rowOf(name, source[bucket]?.[name])));
      },
    },
    source: {
      readableBuckets: () => Promise.resolve(Object.keys({ ...source, ...rowsOnly })),
      read: (bucket, name) => {
        downloads.push(`${bucket}/${name}`);
        return Promise.resolve(source[bucket]?.[name]?.bytes ?? null);
      },
    },
    destination,
    report: (problem, file) => reported.push({ ...file, problem }),
    ...overrides,
  });

  const pass = (options: { from?: CopyCursor | null; limit?: number; overrides?: Partial<CopyDeps> } = {}): Promise<CopySummary> =>
    copyStoredFiles(deps(options.overrides), { buckets: Object.keys({ ...source, ...rowsOnly }), from: options.from ?? null, limit: options.limit ?? 100 });

  it('copies a file under its name with its type and cache rule, and the destination holds the same bytes', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('avatar'), cacheControl: 'max-age=3600' } }, 'chat-media': { 'u1/c1/x.png': { bytes: bytesOf('chat'), contentType: 'image/png' } } };

    const summary = await pass();

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 2, copied: 2, next: null });
    expect(await destination.head('avatars', 'u1/a.jpg')).toEqual({ size: 6, contentType: 'image/jpeg', cacheControl: 'max-age=3600', md5: md5(bytesOf('avatar')) });
    expect(await destination.head('chat-media', 'u1/c1/x.png')).toMatchObject({ contentType: 'image/png', cacheControl: null });
    expect(textOf(await destination.read('chat-media', 'u1/c1/x.png'))).toBe('chat');
    expect(reported).toEqual([]);
  });

  it('downloads nothing on a second pass when the index records each file\'s checksum', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('one') }, 'u2/b.jpg': { bytes: bytesOf('two') } } };
    await pass();
    downloads = [];

    const summary = await pass();

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 2, verified: 2, next: null });
    expect(downloads).toEqual([]);
  });

  it('proves a copy by downloading the file again when its row records no checksum, and writes nothing', async () => {
    source = { avatars: { 'u1/parts.jpg': { bytes: bytesOf('sent in parts'), checksumRecorded: false } } };
    await pass();
    const writes: string[] = [];
    const recording = { ...destinationOf(destination), write: (...args: Parameters<LocalObjectStore['write']>) => (writes.push(args[1]), destination.write(...args)) };

    const summary = await pass({ overrides: { destination: recording } });

    expect(summary).toMatchObject({ scanned: 1, verified: 1, copied: 0, replaced: 0 });
    expect(downloads).toEqual(['avatars/u1/parts.jpg', 'avatars/u1/parts.jpg']);
    expect(writes).toEqual([]);
  });

  it('replaces a file that changed at the source since it was copied', async () => {
    source = { avatars: { 'u1/avatar.jpg': { bytes: bytesOf('first face') } } };
    await pass();
    source = { avatars: { 'u1/avatar.jpg': { bytes: bytesOf('second face, larger'), contentType: 'image/png' } } };

    const summary = await pass();

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 1, replaced: 1, next: null });
    expect(textOf(await destination.read('avatars', 'u1/avatar.jpg'))).toBe('second face, larger');
    expect(await destination.head('avatars', 'u1/avatar.jpg')).toMatchObject({ contentType: 'image/png', md5: md5(bytesOf('second face, larger')) });
  });

  it('leaves alone a file only the destination has, and reports a row whose file no store has', async () => {
    rowsOnly = { 'post-images': ['u1/stored-here.jpg', 'u1/lost.jpg'] };
    await destination.write('post-images', 'u1/stored-here.jpg', bytesOf('uploaded to the new store'), { contentType: 'image/jpeg', cacheControl: null });

    const summary = await pass();

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 2, destinationOnly: 1, absent: 1, next: null });
    expect(textOf(await destination.read('post-images', 'u1/stored-here.jpg'))).toBe('uploaded to the new store');
    expect(reported.map(({ bucket, name }) => ({ bucket, name }))).toEqual([{ bucket: 'post-images', name: 'u1/lost.jpg' }]);
  });

  it('counts and reports a file the source fails on, and copies the others', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('a') }, 'u1/broken.jpg': { bytes: bytesOf('b') }, 'u1/c.jpg': { bytes: bytesOf('c') } } };
    const failure = new Error('the source answered 500');
    const read: CopyDeps['source']['read'] = (bucket, name) => (name === 'u1/broken.jpg' ? Promise.reject(failure) : Promise.resolve(source[bucket]![name]!.bytes));

    const summary = await pass({ overrides: { source: { read, readableBuckets: () => Promise.resolve(['avatars']) } } });

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 3, copied: 2, failed: 1, next: null });
    expect(reported).toEqual([{ bucket: 'avatars', name: 'u1/broken.jpg', problem: failure }]);
    expect(await destination.head('avatars', 'u1/broken.jpg')).toBeNull();
  });

  it('judges no file when the source hides a bucket from its reader: a hidden file would read as one that is gone', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('public') } }, 'chat-media': { 'u1/c1/x.jpg': { bytes: bytesOf('private') } } };
    const read: CopyDeps['source']['read'] = (bucket, name) => Promise.resolve(bucket === 'chat-media' ? null : source[bucket]![name]!.bytes);

    const failure = await pass({ overrides: { source: { read, readableBuckets: () => Promise.resolve(['avatars']) } } }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CopySourceAccessError);
    expect((failure as CopySourceAccessError).buckets).toEqual(['chat-media']);
    expect(await destination.head('avatars', 'u1/a.jpg')).toBeNull();
    expect(reported).toEqual([]);
  });

  it('removes a copy the destination does not report as the bytes that were sent', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('intact at the source') } } };
    // A destination that stores one byte less than it was given, as a transfer cut short would.
    const truncating = { ...destinationOf(destination), write: (...[bucket, name, bytes, object]: Parameters<LocalObjectStore['write']>) => destination.write(bucket, name, bytes.subarray(1), object) };

    const summary = await pass({ overrides: { destination: truncating } });

    expect(summary).toEqual({ ...NOTHING_DONE, scanned: 1, failed: 1, next: null });
    expect(reported[0]?.problem).toBeInstanceOf(CopyNotProvenError);
    expect(await destination.head('avatars', 'u1/a.jpg')).toBeNull();
  });

  it('fails a file whose name the destination took while it was being copied, and leaves that file as it is', async () => {
    source = { avatars: { 'u1/raced.jpg': { bytes: bytesOf('from the source') } } };
    // Another writer stores the name between this pass's look and its write.
    const raced = {
      ...destinationOf(destination),
      write: async (...args: Parameters<LocalObjectStore['write']>) => {
        await destination.write(args[0], args[1], bytesOf('from the other writer'), args[3]);
        return destination.write(...args);
      },
    };

    const summary = await pass({ overrides: { destination: raced } });

    expect(summary).toMatchObject({ scanned: 1, failed: 1, copied: 0 });
    expect(reported[0]?.problem).toBeInstanceOf(CopyNameTakenError);
    expect(textOf(await destination.read('avatars', 'u1/raced.jpg'))).toBe('from the other writer');
  });

  it('handles a bounded number of files per pass and answers where the next pass starts, across buckets, each file once', async () => {
    source = {
      avatars: { 'u1/a.jpg': { bytes: bytesOf('1') }, 'u2/b.jpg': { bytes: bytesOf('2') }, 'u3/c.jpg': { bytes: bytesOf('3') } },
      'chat-media': { 'u1/c1/d.jpg': { bytes: bytesOf('4') } },
      'post-images': { 'u1/p1/e.jpg': { bytes: bytesOf('5') }, 'u1/p1/f.jpg': { bytes: bytesOf('6') } },
    };

    const first = await pass({ limit: 2 });
    const second = await pass({ limit: 3, from: first.next });
    const third = await pass({ limit: 3, from: second.next });

    expect(first).toMatchObject({ scanned: 2, copied: 2, next: { bucket: 'avatars', after: 'u2/b.jpg' } });
    expect(second).toMatchObject({ scanned: 3, copied: 3, next: { bucket: 'post-images', after: 'u1/p1/e.jpg' } });
    expect(third).toMatchObject({ scanned: 1, copied: 1, next: null });
    // Files of one pass are copied side by side, so only what was downloaded is fixed, not the order within a pass.
    expect([...downloads].sort()).toEqual(['avatars/u1/a.jpg', 'avatars/u2/b.jpg', 'avatars/u3/c.jpg', 'chat-media/u1/c1/d.jpg', 'post-images/u1/p1/e.jpg', 'post-images/u1/p1/f.jpg']);
  });

  it('moves on to the buckets after a cursor whose bucket no longer exists, and ends after the last one', async () => {
    source = { avatars: { 'u1/a.jpg': { bytes: bytesOf('a') } }, 'post-images': { 'u1/p.jpg': { bytes: bytesOf('p') } } };

    const afterRemovedBucket = await pass({ from: { bucket: 'chat-media', after: 'u9/z.jpg' } });
    const pastTheEnd = await pass({ from: { bucket: 'zz-last', after: null } });

    expect(afterRemovedBucket).toMatchObject({ scanned: 1, copied: 1, next: null });
    expect(downloads).toEqual(['post-images/u1/p.jpg']);
    expect(pastTheEnd).toEqual({ ...NOTHING_DONE, scanned: 0, next: null });
  });

  it('copies nothing when there is no bucket', async () => {
    expect(await copyStoredFiles(deps(), { buckets: [], from: null, limit: 10 })).toEqual({ ...NOTHING_DONE, scanned: 0, next: null });
  });
});

/** The three calls a pass makes on a store, bound to it, so a test can replace one. */
function destinationOf(store: LocalObjectStore): CopyDeps['destination'] {
  return { head: store.head.bind(store), write: store.write.bind(store), delete: store.delete.bind(store) };
}
