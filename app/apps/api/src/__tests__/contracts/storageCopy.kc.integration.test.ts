import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CopySource } from '../../modules/storageCopy/copyStoredFiles';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const JOBS_TOKEN = 'integration-jobs-token-0123456789abcdef';
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

/**
 * The copy of KC's existing files into its own store (ADR-012 section 6), as
 * the job runs it: on the real index (`storage.objects` of the KC schema),
 * through the jobs route, into a real store. The store the files come from is
 * a stand-in, since no test reaches Supabase Storage.
 */
describe('Copying the existing files, on the KC schema', () => {
  const database = new KcTestDatabase();
  /** A folder only this run writes under: the database is shared with the other suites, and a pass is pointed at it. */
  const folder = `copy-${randomUUID()}`;
  /** What the source holds, by `<bucket>/<name>`. */
  const atSource = new Map<string, Uint8Array>();
  const downloads: string[] = [];
  const copySource: CopySource = {
    readableBuckets: async () => (await database.admin.query<{ id: string }>('select id from storage.buckets')).rows.map((bucket) => bucket.id),
    read: (bucket, name) => {
      downloads.push(name);
      return Promise.resolve(atSource.get(`${bucket}/${name}`) ?? null);
    },
  };
  let gateway: KcGateway;
  let directory: string;
  let store: ObjectStore;

  /** One run of the job, from a cursor inside this run's folder. */
  const copy = async (limit: number, from: { bucket: string; after: string | null } = { bucket: 'avatars', after: `${folder}/` }) => {
    const response = await gateway.app.inject({ method: 'POST', url: '/v1/jobs/copy-stored-files', payload: { from, limit }, headers: { authorization: `Bearer ${JOBS_TOKEN}` } });
    return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
  };

  /**
   * A file as it is today: its bytes at the source, and its row as the
   * source's storage service wrote it.
   * @param entityTag The tag the row records; by default the bytes' MD5 in quotes, as for a file sent in one piece.
   */
  const fileAtSource = async (name: string, bytes: Uint8Array, entityTag = `"${md5(bytes)}"`) => {
    atSource.set(`avatars/${folder}/${name}`, bytes);
    await database.admin.query(
      `insert into storage.objects (bucket_id, name, metadata) values ('avatars', $1, $2::jsonb)
       on conflict (bucket_id, name) do update set metadata = excluded.metadata`,
      [`${folder}/${name}`, JSON.stringify({ eTag: entityTag, size: bytes.byteLength, mimetype: 'image/jpeg', cacheControl: 'max-age=3600' })],
    );
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-storage-copy-'));
    gateway = await startKcGateway({ jobs: { copySource }, config: { jobsToken: JOBS_TOKEN, storage: { localDirectory: directory, publicUrl: 'http://api.kc.test', cloud: null } } });
    store = gateway.app.get<ObjectStore>(OBJECT_STORE);
    // Upper case sorts before lower case in byte order, and after it in most languages' order.
    await fileAtSource('B.jpg', bytesOf('second in the alphabet, first in bytes'));
    await fileAtSource('a.jpg', bytesOf('sent in parts'), '"0123456789abcdef0123456789abcdef-2"');
    await fileAtSource('c.jpg', bytesOf('the last one'));
  });

  afterAll(async () => {
    await database.admin.query("delete from storage.objects where bucket_id = 'avatars' and starts_with(name, $1)", [`${folder}/`]);
    await gateway.app.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('copies the files the index names in byte order, a bounded number per run, each with its type and cache rule', async () => {
    const first = await copy(2);
    const second = await copy(1, first.body.next as { bucket: string; after: string });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, scanned: 2, verified: 0, copied: 2, replaced: 0, destinationOnly: 0, absent: 0, failed: 0, next: { bucket: 'avatars', after: `${folder}/a.jpg` } });
    expect(second.body).toMatchObject({ scanned: 1, copied: 1, failed: 0, next: { bucket: 'avatars', after: `${folder}/c.jpg` } });
    expect(downloads).toEqual([`${folder}/B.jpg`, `${folder}/a.jpg`, `${folder}/c.jpg`]);
    expect(textOf(await store.read('avatars', `${folder}/B.jpg`))).toBe('second in the alphabet, first in bytes');
    expect(await store.head('avatars', `${folder}/c.jpg`)).toEqual({ size: 12, contentType: 'image/jpeg', cacheControl: 'max-age=3600', md5: md5(bytesOf('the last one')) });
  });

  it('proves a second pass from the index alone, and downloads only the file whose row records no checksum', async () => {
    downloads.length = 0;

    const again = await copy(3);

    expect(again.body).toMatchObject({ scanned: 3, verified: 3, copied: 0, replaced: 0, failed: 0 });
    expect(downloads).toEqual([`${folder}/a.jpg`]);
  });

  it('copies again a file that was replaced at the source, and reports a row whose file no store has', async () => {
    await fileAtSource('B.jpg', bytesOf('a new picture under the old name'));
    await fileAtSource('d-lost.jpg', bytesOf('never arrives'));
    atSource.delete(`avatars/${folder}/d-lost.jpg`);

    const pass = await copy(4);

    expect(pass.body).toMatchObject({ scanned: 4, verified: 2, replaced: 1, absent: 1, failed: 0 });
    expect(textOf(await store.read('avatars', `${folder}/B.jpg`))).toBe('a new picture under the old name');
    expect(await store.head('avatars', `${folder}/d-lost.jpg`)).toBeNull();
  });
});
