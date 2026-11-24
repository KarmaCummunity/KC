import 'reflect-metadata';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IPostRepository, newPostInput } from '@kc/application';
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

/**
 * The two scheduled jobs that clean up files, on KC's own storage and the
 * real KC schema (ADR-012 section 5): the removal of files no row references,
 * and the purge of an account past its grace period with every file it had.
 */
describe.skipIf(!KC_DATABASE_URL)('File clean-up jobs on the KC schema', () => {
  const database = new KcTestDatabase();
  const address = {} as Address;
  let gateway: KcGateway;
  let directory: string;
  let store: ObjectStore;

  const runJob = async (name: string) => {
    const response = await gateway.app.inject({ method: 'POST', url: `/v1/jobs/${name}`, payload: {}, headers: { authorization: `Bearer ${JOBS_TOKEN}` } });
    return { status: response.statusCode, body: response.json<Record<string, number>>() };
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
