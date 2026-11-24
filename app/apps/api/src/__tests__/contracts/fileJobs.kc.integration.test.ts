import 'reflect-metadata';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IPostRepository, newPostInput } from '@kc/application';
import { Jimp } from 'jimp';
import type { Address } from '@kc/domain';
import { type ApiStorage, createApiStorage } from '@kc/infrastructure-api';
import { SupabasePostRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';
import { injectFetch } from '../support/storageRequests';

const JOBS_TOKEN = 'integration-jobs-token-0123456789abcdef';
const JPEG = 'image/jpeg';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const latin1 = (bytes: Uint8Array | null) => new TextDecoder('latin1').decode(bytes ?? new Uint8Array());

/** A real JPEG that carries a metadata segment naming where it was taken, as a phone's camera writes. */
async function photoWithLocation(): Promise<Uint8Array> {
  const jpeg = new Uint8Array(await new Jimp({ width: 64, height: 48, color: 0x336699ff }).getBuffer('image/jpeg', { quality: 90 }));
  const metadata = new TextEncoder().encode('Exif\0\0GPSLatitude 32.0853 GPSLongitude 34.7818');
  // An APP1 segment right after the start-of-image marker: marker, length (itself included), body.
  const segment = Uint8Array.of(0xff, 0xe1, (metadata.length + 2) >> 8, (metadata.length + 2) & 0xff, ...metadata);
  return Uint8Array.of(...jpeg.subarray(0, 2), ...segment, ...jpeg.subarray(2));
}

/**
 * The scheduled jobs that work on files, on KC's own storage and the real KC
 * schema (ADR-012 section 5): the sanitized copy of a new post photo, the
 * removal of files no row references, and the purge of an account past its
 * grace period with every file it had.
 */
describe.skipIf(!KC_DATABASE_URL)('File jobs on the KC schema', () => {
  const database = new KcTestDatabase();
  const address = {} as Address;
  let gateway: KcGateway;
  let directory: string;
  let store: ObjectStore;

  const runJob = async (name: string, payload: Record<string, unknown> = {}) => {
    const response = await gateway.app.inject({ method: 'POST', url: `/v1/jobs/${name}`, payload, headers: { authorization: `Bearer ${JOBS_TOKEN}` } });
    return { status: response.statusCode, body: response.json<Record<string, any>>() }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const storageOf = (member: TestMember): ApiStorage =>
    createApiStorage({ baseUrl: 'http://api.kc.test', getAccessToken: () => gateway.issuer.sign(member.userId), fetch: injectFetch(gateway.app) });
  const postsOf = (member: TestMember): IPostRepository => new SupabasePostRepository(database.clientFor(member.caller));
  const upload = (member: TestMember, bucket: string, name: string) => storageOf(member).upload({ bucket, name, bytes: PHOTO, contentType: JPEG });
  const indexed = async (bucket: string, name: string) => (await database.admin.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount === 1;
  /** Whether the file is in the store, and whether it is in the index. */
  const stateOf = async (bucket: string, name: string) => ({ stored: (await store.head(bucket, name)) !== null, indexed: await indexed(bucket, name) });
  /** Makes a stored file look two days old to the local store, which reads a file's age from its last write. */
  const age = (bucket: string, name: string) => utimes(join(directory, bucket, ...name.split('/')), TWO_DAYS_AGO, TWO_DAYS_AGO);

  /**
   * The member asks to delete their account, as the app does, and the 30 days
   * of grace are then moved into the past. The dates are changed in a
   * transaction of their own with empty claims: a pooled connection keeps an
   * empty claims setting from an earlier caller, which the account's triggers
   * cannot read.
   */
  const endGracePeriod = async (member: TestMember) => {
    const { error } = await database.clientFor<SqlBackedClient>(member.caller).rpc('request_account_deletion');
    if (error) throw new Error(`request_account_deletion: ${error.message}`);
    const admin = await database.admin.connect();
    try {
      await admin.query('begin');
      await admin.query("select set_config('request.jwt.claims', '{}', true)");
      await admin.query("update public.user_account set deletion_requested_at = now() - interval '31 days', deletion_purge_at = now() - interval '1 day' where user_id = $1", [member.userId]);
      await admin.query('commit');
    } finally {
      admin.release();
    }
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-file-jobs-'));
    gateway = await startKcGateway({ config: { jobsToken: JOBS_TOKEN, storage: { localDirectory: directory, publicUrl: 'http://api.kc.test' } } });
    store = gateway.app.get<ObjectStore>(OBJECT_STORE);
    const city = (await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1')).rows[0];
    if (!city) throw new Error('the reference seed is not loaded: no city');
    Object.assign(address, { city: city.city_id, cityName: city.name_he, street: 'Clean-up St', streetNumber: '1' });
  });

  afterAll(async () => {
    await gateway.app.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('makes the sanitized copy of a new post photo: where it was taken never reaches the copy, and the photo is marked ready', async () => {
    const alice = await database.newMember();
    // A photo queued before Alice's whose file never reached the store: the worker must refuse it and go on.
    const earlier = await database.newMember();
    await postsOf(earlier).create(newPostInput(earlier.userId, address, { mediaAssets: [{ path: `${earlier.userId}/batch/never-stored.jpg`, mimeType: JPEG, sizeBytes: 10 }] }));
    const photo = await photoWithLocation();
    const path = `${alice.userId}/batch-copy/0.jpg`;
    await storageOf(alice).upload({ bucket: 'post-images', name: path, bytes: photo, contentType: JPEG });
    const post = await postsOf(alice).create(newPostInput(alice.userId, address, { mediaAssets: [{ path, mimeType: JPEG, sizeBytes: photo.byteLength }] }));
    const mediaId = (await database.admin.query<{ id: string }>('select id from public.post_media where post_id = $1', [post.postId])).rows[0]?.id as string;

    // Other suites queue photos of their own on this database, and a run takes a few jobs: run until this one was handed out.
    let outcome: string | undefined;
    for (let run = 0; run < 40 && outcome === undefined; run += 1) outcome = (await runJob('process-post-media', { limit: 5 })).body.outcomes?.[mediaId];

    expect(outcome).toBe('ready');
    const key = `derived/${alice.userId}/${mediaId}-a1.jpg`;
    const copy = await store.read('post-images', key);
    expect(latin1(photo)).toContain('GPSLatitude');
    expect(latin1(copy)).not.toContain('GPSLatitude');
    expect(await stateOf('post-images', key)).toEqual({ stored: true, indexed: true });
    const job = (await database.admin.query<{ state: string; derivative_key: string }>('select state, derivative_key from kc_private.post_media_processing where media_id = $1', [mediaId])).rows[0];
    expect(job).toEqual({ state: 'done', derivative_key: key });
    // The photo's row now names the copy: that is the file everyone else is shown.
    const shown = (await database.admin.query<{ processing_status: string; storage_key: string }>('select processing_status, storage_key from public.post_media where id = $1', [mediaId])).rows[0];
    expect(shown).toEqual({ processing_status: 'ready', storage_key: key });
    // The upload itself is still stored, untouched.
    expect(await stateOf('post-images', path)).toEqual({ stored: true, indexed: true });
  });

  it('removes old files no row references, confirmed or not, and keeps a post\'s photo and a fresh upload', async () => {
    const alice = await database.newMember();
    const referenced = `${alice.userId}/batch/0.jpg`;
    const orphan = `${alice.userId}/batch/abandoned.jpg`;
    const unconfirmed = `${alice.userId}/batch/never-confirmed.jpg`;
    const fresh = `${alice.userId}/batch/just-now.jpg`;
    await upload(alice, 'post-images', referenced);
    await upload(alice, 'post-images', orphan);
    await upload(alice, 'post-images', fresh);
    // Bytes that reached the store and were never confirmed into the index.
    await store.write('post-images', unconfirmed, PHOTO, { contentType: JPEG, cacheControl: null });
    await postsOf(alice).create(newPostInput(alice.userId, address, { mediaAssets: [{ path: referenced, mimeType: JPEG, sizeBytes: PHOTO.byteLength }] }));
    await Promise.all([referenced, orphan, unconfirmed].map((name) => age('post-images', name)));

    const { status, body } = await runJob('reconcile-storage-orphans');

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, scanned: 3, removed: 2, errors: 0 });
    expect(await stateOf('post-images', orphan)).toEqual({ stored: false, indexed: false });
    expect(await stateOf('post-images', unconfirmed)).toEqual({ stored: false, indexed: false });
    expect(await stateOf('post-images', referenced)).toEqual({ stored: true, indexed: true });
    // Old enough to judge tomorrow; today its row may simply not be written yet.
    expect(await stateOf('post-images', fresh)).toEqual({ stored: true, indexed: true });
  });

  it('purges an account past its grace period with every file it had, and leaves everyone else\'s', async () => {
    const [leaving, staying] = await Promise.all([database.newMember(), database.newMember()]);
    const own = [
      ['avatars', `${leaving.userId}/avatar.jpg`],
      ['post-images', `${leaving.userId}/batch/0.jpg`],
    ] as const;
    for (const [bucket, name] of own) await upload(leaving, bucket, name);
    // A copy the server made of the member's photo, outside their own folder.
    const derived = `derived/${leaving.userId}/media-a1.jpg`;
    await store.write('post-images', derived, PHOTO, { contentType: JPEG, cacheControl: null });
    const kept = `${staying.userId}/avatar.jpg`;
    await upload(staying, 'avatars', kept);
    await endGracePeriod(leaving);

    const { status, body } = await runJob('purge-deleted-accounts');

    expect(status).toBe(200);
    expect(body).toMatchObject({ failed: 0, deferred: 0 });
    expect(body.purged).toBeGreaterThanOrEqual(1);
    for (const [bucket, name] of own) expect(await stateOf(bucket, name), `${bucket}/${name}`).toEqual({ stored: false, indexed: false });
    expect(await store.head('post-images', derived)).toBeNull();
    expect((await database.admin.query('select 1 from auth.users where id = $1', [leaving.userId])).rowCount).toBe(0);
    expect(await stateOf('avatars', kept)).toEqual({ stored: true, indexed: true });
    expect((await database.admin.query('select 1 from auth.users where id = $1', [staying.userId])).rowCount).toBe(1);
  });
});
