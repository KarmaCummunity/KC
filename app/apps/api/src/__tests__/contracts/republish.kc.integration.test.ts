import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IPostRepository, newPostInput } from '@kc/application';
import type { Address } from '@kc/domain';
import { type ApiStorage, createApiStorage, createPortTransport, createRemotePort, type PortManifest } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { freePort, type KcGateway, startKcGateway } from '../support/kcGateway';

const BUCKET = 'post-images';
const JPEG = 'image/jpeg';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 10, 20, 30, 40, 50]);
const THUMB = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

/**
 * Republishing a post through the gateway (FR-POST-013 AC3, D127) on a server
 * with a file store: the hosted adapter, unchanged, reads each photo back
 * from its public address and stores a copy, and both happen on KC's own
 * storage as the member (ADR-012 section 5). The server listens on a real
 * port, because the adapter fetches the public address over HTTP.
 */
describe.skipIf(!KC_DATABASE_URL)('Republishing a post with its photos on the KC schema', () => {
  const database = new KcTestDatabase();
  const address = {} as Address;
  let gateway: KcGateway;
  let baseUrl: string;
  let directory: string;
  let store: ObjectStore;
  let alice: TestMember;
  let bob: TestMember;

  const tokenOf = (member: TestMember) => () => gateway.issuer.sign(member.userId);
  const postsOf = (member: TestMember) => createRemotePort<IPostRepository>(createPortTransport({ baseUrl, getAccessToken: tokenOf(member) }), 'post');
  const storageOf = (member: TestMember): ApiStorage => createApiStorage({ baseUrl, getAccessToken: tokenOf(member) });
  const mediaOf = async (postId: string) => (await database.admin.query<{ storage_key: string }>('select storage_key from public.post_media where post_id = $1 order by ordinal', [postId])).rows.map((row) => row.storage_key);
  const indexed = async (name: string) => (await database.admin.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [BUCKET, name])).rowCount === 1;

  /** A post of `owner` with one stored photo and its thumbnail; resolves with the post's id and the photo's path. */
  const postWithPhoto = async (owner: TestMember) => {
    const path = `${owner.userId}/batch-${crypto.randomUUID().slice(0, 8)}/0.jpg`;
    const storage = storageOf(owner);
    await storage.upload({ bucket: BUCKET, name: path, bytes: PHOTO, contentType: JPEG });
    await storage.upload({ bucket: BUCKET, name: path.replace('.jpg', '-thumb.jpg'), bytes: THUMB, contentType: JPEG });
    const post = await postsOf(owner).create(newPostInput(owner.userId, address, { mediaAssets: [{ path, mimeType: JPEG, sizeBytes: PHOTO.byteLength }] }));
    return { postId: post.postId, path };
  };

  beforeAll(async () => {
    const port = await freePort();
    directory = await mkdtemp(join(tmpdir(), 'kc-republish-'));
    gateway = await startKcGateway({ config: { storage: { localDirectory: directory, publicUrl: `http://127.0.0.1:${port}` } }, port });
    baseUrl = await gateway.listen();
    store = gateway.app.get<ObjectStore>(OBJECT_STORE);
    [alice, bob] = await Promise.all([database.newMember(), database.newMember()]);
    const city = (await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1')).rows[0];
    if (!city) throw new Error('the reference seed is not loaded: no city');
    Object.assign(address, { city: city.city_id, cityName: city.name_he, street: 'Republish St', streetNumber: '1' });
  });

  afterAll(async () => {
    await database.admin.query('delete from storage.objects where split_part(name, $1, 1) = any($2)', ['/', [alice.userId, bob.userId]]);
    await gateway.app.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('lists republish as served: this server has a file store', async () => {
    const manifest = (await gateway.app.inject({ method: 'GET', url: '/v1/ports' })).json<PortManifest>();

    expect(manifest.ports.post).toContain('republish');
  });

  it('publishes a new post with copies of the photo and its thumbnail, stored and indexed as the owner', async () => {
    const original = await postWithPhoto(alice);

    const republishedId = await postsOf(alice).republish(original.postId);

    expect(republishedId).not.toBe(original.postId);
    const [copy, ...more] = await mediaOf(republishedId);
    expect(more).toEqual([]);
    // A stored file belongs to one post: the copy is a new file in a new batch of the owner's folder.
    expect(copy).toMatch(new RegExp(`^${alice.userId}/republish-[a-z0-9]+/0\\.jpg$`));
    expect(copy).not.toBe(original.path);
    const thumb = (copy as string).replace('.jpg', '-thumb.jpg');
    expect(Array.from((await store.read(BUCKET, copy as string)) ?? [])).toEqual(Array.from(PHOTO));
    expect(Array.from((await store.read(BUCKET, thumb)) ?? [])).toEqual(Array.from(THUMB));
    expect([await indexed(copy as string), await indexed(thumb)]).toEqual([true, true]);
    // The old post keeps its own files.
    expect(await mediaOf(original.postId)).toEqual([original.path]);
    expect(await store.head(BUCKET, original.path)).not.toBeNull();
  });

  it('does not let another member republish a post or write into its owner\'s folder', async () => {
    const original = await postWithPhoto(alice);
    const before = (await database.admin.query<{ count: string }>("select count(*) from storage.objects where name like $1 || '/%'", [alice.userId])).rows[0]?.count;

    await expect(postsOf(bob).republish(original.postId)).rejects.toBeInstanceOf(Error);

    const after = (await database.admin.query<{ count: string }>("select count(*) from storage.objects where name like $1 || '/%'", [alice.userId])).rows[0]?.count;
    expect(after).toBe(before);
    expect((await database.admin.query('select 1 from public.posts where owner_id = $1', [bob.userId])).rowCount).toBe(0);
  });
});
