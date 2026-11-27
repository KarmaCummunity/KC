import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalObjectStore } from '../../../platform/storage/localObjectStore';
import { createCopyIndex } from '../copyIndex';
import { type CopyDeps, type CopySource, CopySourceAccessError, copyStoredFiles } from '../copyStoredFiles';
import { CopySourceError, createSupabaseStorageSource } from '../supabaseStorageSource';

// The copy against a real Supabase Storage: files are uploaded through its own
// API, so the rows the index is read from and the answers the source gives are
// the service's and not this repository's idea of them. Collected only when
// KC_API_TEST_SUPABASE_URL names a local Supabase stack that runs its storage
// service (vitest.config.ts); the backend CI lane provides one.

const URL_BASE = process.env.KC_API_TEST_SUPABASE_URL as string;
const SERVICE_KEY = process.env.KC_API_TEST_SUPABASE_SERVICE_KEY as string;
/** The project's key for signed-out visitors: accepted by the service, and shown no private file. */
const ANON_KEY = process.env.KC_API_TEST_SUPABASE_ANON_KEY as string;
const DATABASE_URL = process.env.KC_API_TEST_SUPABASE_DATABASE_URL as string;

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

describe('Copying from a real Supabase Storage', () => {
  /** A folder only this run writes under; a pass is pointed at it, so files of other runs are not in its way. */
  const folder = `copy-${randomUUID()}`;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const downloads: string[] = [];
  let directory: string;
  let destination: LocalObjectStore;
  let source: CopySource;

  /** Stores a file at the source the way the app does: one request to the storage service. */
  const uploadToSource = async (bucket: string, name: string, bytes: Uint8Array, options: { replace?: boolean; contentType?: string } = {}) => {
    const response = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${folder}/${name}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': options.contentType ?? 'image/jpeg',
        'cache-control': 'max-age=3600',
        ...(options.replace ? { 'x-upsert': 'true' } : {}),
      },
      // A copy with a buffer of its own, which is what a request body is typed to take.
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`upload to the source failed: ${response.status} ${await response.text()}`);
  };

  /** This run's files of each bucket, as uploaded below. */
  const FILES = { avatars: ['a.jpg', 'b.jpg'], 'chat-media': ['c1/x.png'] } as const;

  /** One pass over this run's files of a bucket, into the local store. */
  const pass = (bucket: keyof typeof FILES, overrides: Partial<CopyDeps> = {}) =>
    copyStoredFiles(
      {
        index: createCopyIndex({ runAsService: (work) => work(pool) }),
        source: {
          readableBuckets: () => source.readableBuckets(),
          read: (...args) => {
            downloads.push(args[1]);
            return source.read(...args);
          },
        },
        destination,
        report: () => undefined,
        ...overrides,
      },
      // The limit is this run's own files, so the pass ends before any other run's.
      { buckets: [bucket], from: { bucket, after: `${folder}/` }, limit: FILES[bucket].length },
    );

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-supabase-copy-'));
    destination = new LocalObjectStore({ directory, baseUrl: 'http://api.kc.test', signingSecret: 'copy-secret' });
    source = createSupabaseStorageSource({ url: URL_BASE, key: SERVICE_KEY });
    await uploadToSource('avatars', 'a.jpg', bytesOf('a public avatar'));
    await uploadToSource('avatars', 'b.jpg', bytesOf('another avatar'));
    await uploadToSource('chat-media', 'c1/x.png', bytesOf('a private chat photo'), { contentType: 'image/png' });
  });

  afterAll(async () => {
    // Removed through the service, which owns its table: it refuses a delete made in SQL.
    for (const [bucket, names] of Object.entries(FILES)) {
      await fetch(`${URL_BASE}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: names.map((name) => `${folder}/${name}`) }),
      });
    }
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  });

  it('copies public and private files as the service recorded them: bytes, type and cache rule', async () => {
    const avatars = await pass('avatars');
    const chat = await pass('chat-media');

    expect(avatars).toMatchObject({ scanned: 2, copied: 2, failed: 0, absent: 0 });
    expect(chat).toMatchObject({ scanned: 1, copied: 1, failed: 0, absent: 0 });
    expect(textOf(await destination.read('avatars', `${folder}/a.jpg`))).toBe('a public avatar');
    expect(await destination.head('avatars', `${folder}/a.jpg`)).toMatchObject({ size: 15, contentType: 'image/jpeg', cacheControl: 'max-age=3600' });
    expect(textOf(await destination.read('chat-media', `${folder}/c1/x.png`))).toBe('a private chat photo');
    expect(await destination.head('chat-media', `${folder}/c1/x.png`)).toMatchObject({ contentType: 'image/png' });
  });

  it('proves a second pass from the checksums the service recorded, without downloading a file', async () => {
    downloads.length = 0;

    expect(await pass('avatars')).toMatchObject({ scanned: 2, verified: 2, copied: 0, replaced: 0 });
    expect(downloads).toEqual([]);
  });

  it('copies again a file that was replaced at the source', async () => {
    await uploadToSource('avatars', 'a.jpg', bytesOf('a new face under the old name'), { replace: true });

    expect(await pass('avatars')).toMatchObject({ scanned: 2, verified: 1, replaced: 1, failed: 0 });
    expect(textOf(await destination.read('avatars', `${folder}/a.jpg`))).toBe('a new face under the old name');
  });

  it('answers null for a file the service does not have', async () => {
    expect(await source.read('avatars', `${folder}/never-uploaded.jpg`, 1024)).toBeNull();
    expect(await source.read('chat-media', `${folder}/never-uploaded.jpg`, 1024)).toBeNull();
  });

  it('fails, and never reads as "no such file", with a key the service does not accept', async () => {
    const refused = createSupabaseStorageSource({ url: URL_BASE, key: 'not-a-key-of-this-project' });

    await expect(refused.read('chat-media', `${folder}/c1/x.png`, 1024)).rejects.toBeInstanceOf(CopySourceError);
    await expect(refused.read('chat-media', `${folder}/never-uploaded.jpg`, 1024)).rejects.toBeInstanceOf(CopySourceError);
    await expect(refused.readableBuckets()).rejects.toBeInstanceOf(CopySourceError);
  });

  it('refuses a pass with a key that is accepted and shown no private file, where every such file would read as gone', async () => {
    const visitor = createSupabaseStorageSource({ url: URL_BASE, key: ANON_KEY });
    // What makes the check necessary: the service answers this key exactly as it answers for a file that does not exist.
    expect(await visitor.read('chat-media', `${folder}/c1/x.png`, 1024)).toBeNull();

    const failure = await pass('chat-media', { source: visitor }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CopySourceAccessError);
    expect((failure as CopySourceAccessError).buckets).toEqual(['chat-media']);
  });
});
