import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiStorage, publicObjectName, StorageRequestError } from '@kc/infrastructure-api';
import { SupabaseChatRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CALLER_FILES, type CallerFiles } from '../../platform/ports/callerFiles';
import type { InProcessBucket } from '../../platform/postgrest/sqlBackedClient';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';
import { injectFetch, pathOf } from '../support/storageRequests';

const JPEG = 'image/jpeg';
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/**
 * The two clients of KC's file storage, each against the real server on the
 * KC policies: the app's own storage client (`@kc/infrastructure-api`), and
 * the `client.storage` a hosted adapter reaches on the server (ADR-012
 * sections 4 and 5).
 */
describe.skipIf(!KC_DATABASE_URL)('File storage clients on the KC schema', () => {
  const database = new KcTestDatabase();
  let gateway: KcGateway;
  let directory: string;
  let store: ObjectStore;
  let alice: TestMember;
  let bob: TestMember;
  let outsider: TestMember;
  /** A direct chat between Alice and Bob. */
  let chatId: string;

  /** The app's storage client, signed in as `member`; its requests are answered by the gateway in process. */
  const storageOf = (member: TestMember) => createApiStorage({ baseUrl: 'http://api.kc.test', getAccessToken: () => gateway.issuer.sign(member.userId), fetch: injectFetch(gateway.app) });
  const rowsOf = async (bucket: string, name: string) =>
    (await database.admin.query<{ metadata: Record<string, unknown> }>('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rows;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-storage-clients-'));
    gateway = await startKcGateway({ config: { storage: { localDirectory: directory, publicUrl: 'http://api.kc.test' } } });
    store = gateway.app.get<ObjectStore>(OBJECT_STORE);
    [alice, bob, outsider] = await Promise.all([database.newMember(), database.newMember(), database.newMember()]);
    chatId = (await new SupabaseChatRepository(database.clientFor(alice.caller)).findOrCreateChat(alice.userId, bob.userId)).chatId;
  });

  afterAll(async () => {
    await database.admin.query('delete from storage.objects where split_part(name, $1, 1) = any($2)', ['/', [alice, bob, outsider].map((member) => member.userId)]);
    await gateway.app.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves the app\'s own storage client: upload, signed address, delete, and the refusals as typed errors', async () => {
    const name = `${alice.userId}/${chatId}/from-the-app.jpg`;
    const storage = storageOf(alice);

    await storage.upload({ bucket: 'chat-media', name, bytes: PHOTO, contentType: JPEG, cacheControl: 'private, max-age=3600' });

    expect(await rowsOf('chat-media', name)).toEqual([{ metadata: { size: PHOTO.byteLength, mimetype: JPEG, cacheControl: 'private, max-age=3600' } }]);
    const signedUrl = await storageOf(bob).signedUrl({ bucket: 'chat-media', name }, 600);
    expect((await gateway.app.inject({ method: 'GET', url: pathOf(signedUrl) })).rawPayload.equals(PHOTO)).toBe(true);

    await expect(storage.upload({ bucket: 'chat-media', name, bytes: PHOTO, contentType: JPEG })).rejects.toEqual(new StorageRequestError(409, 'exists'));
    await expect(storageOf(outsider).signedUrl({ bucket: 'chat-media', name }, 600)).rejects.toEqual(new StorageRequestError(403, 'forbidden'));
    await expect(storageOf(bob).upload({ bucket: 'avatars', name: `${alice.userId}/by-bob.jpg`, bytes: PHOTO, contentType: JPEG })).rejects.toEqual(new StorageRequestError(403, 'forbidden'));

    expect(await storageOf(bob).remove('chat-media', [name])).toEqual([]);
    expect(await storage.remove('chat-media', [name])).toEqual([name]);
    await expect(storageOf(bob).signedUrl({ bucket: 'chat-media', name }, 600)).rejects.toEqual(new StorageRequestError(404, 'not_found'));
  });

  it('serves a public file at the address shape the app and the database already use', async () => {
    const name = `${alice.userId}/shape.jpg`;
    await storageOf(alice).upload({ bucket: 'avatars', name, bytes: PHOTO, contentType: JPEG });

    const address = store.publicUrl('avatars', name);

    expect(address).toBe(`http://api.kc.test/storage/v1/object/public/avatars/${name}`);
    expect(publicObjectName(address, 'avatars')).toBe(name);
    expect((await gateway.app.inject({ method: 'GET', url: pathOf(address) })).statusCode).toBe(200);
  });

  describe('as a hosted adapter reaches it (client.storage)', () => {
    const filesOf = (member: TestMember | null) => gateway.app.get<CallerFiles>(CALLER_FILES).forCaller(member?.caller ?? null)?.from('avatars') as InProcessBucket;

    it('stores and indexes an upload as the member, under the same policy and bucket rules', async () => {
      const name = `${alice.userId}/by-adapter.jpg`;

      expect(await filesOf(alice).upload(name, PHOTO, { contentType: JPEG, upsert: false })).toEqual({ data: { path: name }, error: null });

      expect(await rowsOf('avatars', name)).toEqual([{ metadata: { size: PHOTO.byteLength, mimetype: JPEG, cacheControl: null } }]);
      expect(filesOf(alice).getPublicUrl(name).data.publicUrl).toBe(store.publicUrl('avatars', name));
      // A second upload of the name is refused and the first bytes stay.
      expect((await filesOf(alice).upload(name, Buffer.from([9]), { contentType: JPEG })).error).toEqual({ message: 'exists' });
      expect(Buffer.from((await store.read('avatars', name)) ?? []).equals(PHOTO)).toBe(true);
    });

    it.each<[string, () => TestMember | null, string, { contentType?: string; upsert?: boolean }, string]>([
      ['another member\'s folder', () => bob, 'x.jpg', { contentType: JPEG }, 'forbidden'],
      ['a signed-out visitor', () => null, 'x.jpg', { contentType: JPEG }, 'forbidden'],
      ['a type the bucket does not take', () => alice, 'x.gif', { contentType: 'image/gif' }, 'type_not_allowed'],
      ['an upload with no type', () => alice, 'x.bin', {}, 'type_not_allowed'],
      ['a request to replace a file', () => alice, 'x.jpg', { contentType: JPEG, upsert: true }, 'upsert_not_supported'],
    ])('refuses %s and stores nothing', async (_case, member, file, options, message) => {
      const name = `${alice.userId}/refused-${file}`;

      expect(await filesOf(member()).upload(name, PHOTO, options)).toEqual({ data: null, error: { message } });

      expect(await store.head('avatars', name)).toBeNull();
      expect(await rowsOf('avatars', name)).toEqual([]);
    });

    it('refuses a file larger than the bucket takes, and never turns a climbing path into an address', async () => {
      const name = `${alice.userId}/too-large.jpg`;

      expect((await filesOf(alice).upload(name, Buffer.alloc(524_289), { contentType: JPEG })).error).toEqual({ message: 'too_large' });
      expect(await store.head('avatars', name)).toBeNull();
      expect(() => filesOf(alice).getPublicUrl(`${alice.userId}/../../v1/ports`)).toThrow();
    });
  });
});
