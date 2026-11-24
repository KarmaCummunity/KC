import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupabaseChatRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';
import { pathOf } from '../support/storageRequests';

const JPEG = 'image/jpeg';
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/**
 * File storage end to end (ADR-012 section 4) on the real KC policies, with
 * the local-directory store: a member asks for an upload, sends the bytes to
 * the address they are given, confirms, and the file is in the index; reading
 * a private file and deleting go through the same policies.
 */
describe.skipIf(!KC_DATABASE_URL)('File storage on the KC schema', () => {
  const database = new KcTestDatabase();
  let gateway: KcGateway;
  let directory: string;
  let store: ObjectStore;
  let alice: TestMember;
  let bob: TestMember;
  let outsider: TestMember;
  /** A direct chat between Alice and Bob. */
  let chatId: string;

  /** A storage request of a member; `userId` null sends no token. */
  const call = async (userId: string | null, route: string, body: unknown) => {
    const response = await gateway.app.inject({
      method: 'POST',
      url: `/v1/storage/${route}`,
      payload: body as object,
      headers: userId ? { authorization: `Bearer ${await gateway.issuer.sign(userId)}` } : {},
    });
    return { status: response.statusCode, body: response.json<Record<string, any>>() }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const send = (url: string, bytes: Buffer, contentType = JPEG) => gateway.app.inject({ method: 'PUT', url: pathOf(url), payload: bytes, headers: { 'content-type': contentType } });
  const grant = (member: TestMember, bucket: string, name: string, over: Record<string, unknown> = {}) =>
    call(member.userId, 'uploads', { bucket, name, contentType: JPEG, size: PHOTO.byteLength, ...over });
  /** The whole upload of one file, as the app does it. */
  const upload = async (member: TestMember, bucket: string, name: string) => {
    const granted = await grant(member, bucket, name);
    await send(granted.body.upload.url, PHOTO);
    return call(member.userId, 'uploads/complete', { bucket, name });
  };
  const rowsOf = async (bucket: string, name: string) =>
    (await database.admin.query<{ metadata: Record<string, unknown> }>('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rows;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-storage-'));
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

  it('takes a member\'s avatar: grant, bytes, confirmation, and the file is in the index and served', async () => {
    const name = `${alice.userId}/avatar-1.jpg`;

    const granted = await grant(alice, 'avatars', name, { cacheControl: 'public, max-age=31536000, immutable' });
    expect(granted.status).toBe(200);
    expect(granted.body.upload).toMatchObject({ method: 'PUT', headers: { 'content-type': JPEG } });
    // Nothing is in the index until the bytes were sent and confirmed.
    expect(await rowsOf('avatars', name)).toEqual([]);

    expect((await send(granted.body.upload.url, PHOTO)).statusCode).toBe(200);
    expect(await call(alice.userId, 'uploads/complete', { bucket: 'avatars', name })).toEqual({ status: 200, body: { path: name } });

    expect(await rowsOf('avatars', name)).toEqual([{ metadata: { size: PHOTO.byteLength, mimetype: JPEG, cacheControl: 'public, max-age=31536000, immutable' } }]);
    const served = await gateway.app.inject({ method: 'GET', url: pathOf(store.publicUrl('avatars', name)) });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(PHOTO)).toBe(true);
    expect(served.headers).toMatchObject({ 'content-type': JPEG, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
  });

  it('grants nothing outside the member\'s own folder, under the server\'s folder, or in an unknown bucket', async () => {
    expect((await grant(bob, 'avatars', `${alice.userId}/by-bob.jpg`)).status).toBe(403);
    expect((await grant(alice, 'post-images', `derived/${alice.userId}/x.jpg`)).status).toBe(403);
    expect((await grant(alice, 'no-such-bucket', `${alice.userId}/x.jpg`)).status).toBe(403);
    expect((await call(null, 'uploads', { bucket: 'avatars', name: `${alice.userId}/x.jpg`, contentType: JPEG, size: 1 })).status).toBe(401);
  });

  it('holds a grant to the bucket\'s own rules and to a well-formed request', async () => {
    const name = `${alice.userId}/rules.jpg`;

    // The avatars bucket takes JPEG up to 512 KB.
    expect(await grant(alice, 'avatars', name, { size: 524_289 })).toEqual({ status: 413, body: { error: 'too_large' } });
    expect(await grant(alice, 'avatars', name, { contentType: 'image/gif' })).toEqual({ status: 415, body: { error: 'type_not_allowed' } });
    for (const over of [{ size: 0 }, { size: 1.5 }, { size: '8' }, { contentType: '' }, { name: `${alice.userId}/../x.jpg` }, { name: 7 }, { bucket: null }]) {
      expect((await grant(alice, 'avatars', name, over)).status, JSON.stringify(over)).toBe(400);
    }
  });

  it('stores only what the grant says: the granted type, within the granted size, once', async () => {
    const name = `${alice.userId}/strict.jpg`;
    const { url } = (await grant(alice, 'avatars', name)).body.upload;

    expect((await send(url, PHOTO, 'image/png')).statusCode).toBe(415);
    expect((await send(url, Buffer.alloc(524_289))).statusCode).toBe(413);
    expect(await store.head('avatars', name)).toBeNull();

    expect((await send(url, PHOTO)).statusCode).toBe(200);
    // The same address cannot replace what it stored.
    expect((await send(url, Buffer.from([9, 9, 9]))).statusCode).toBe(409);
    expect(Buffer.from((await store.read('avatars', name)) ?? []).equals(PHOTO)).toBe(true);
  });

  it('accepts bytes only at an address it signed for uploading', async () => {
    const name = `${alice.userId}/forged.jpg`;
    const { url } = (await grant(alice, 'avatars', name)).body.upload;
    // A read address of a file that exists: valid, signed by the same key, but for reading.
    const existing = `${alice.userId}/readable.jpg`;
    await upload(alice, 'avatars', existing);
    const readUrl = (await call(alice.userId, 'signed-urls', { bucket: 'avatars', name: existing, expiresIn: 60 })).body.signedUrl as string;

    const tampered = `${url.slice(0, -2)}xx`;
    const readTokenAsUpload = url.replace(/[^=]+$/, readUrl.split('=').pop() as string);

    expect((await send(tampered, PHOTO)).statusCode).toBe(403);
    expect((await send(readTokenAsUpload, PHOTO)).statusCode).toBe(403);
    expect(await store.head('avatars', name)).toBeNull();
  });

  it('confirms only a file that was sent, and only for the member whose it is', async () => {
    const name = `${alice.userId}/confirm.jpg`;
    const { url } = (await grant(alice, 'avatars', name)).body.upload;

    expect(await call(alice.userId, 'uploads/complete', { bucket: 'avatars', name })).toEqual({ status: 404, body: { error: 'not_uploaded' } });
    await send(url, PHOTO);

    // Another member can neither claim the file nor make it disappear.
    expect((await call(bob.userId, 'uploads/complete', { bucket: 'avatars', name })).status).toBe(403);
    expect(await store.head('avatars', name)).not.toBeNull();
    expect(await rowsOf('avatars', name)).toEqual([]);

    // Confirming twice (a lost answer, a retry) leaves one row.
    expect((await call(alice.userId, 'uploads/complete', { bucket: 'avatars', name })).status).toBe(200);
    expect((await call(alice.userId, 'uploads/complete', { bucket: 'avatars', name })).status).toBe(200);
    expect(await rowsOf('avatars', name)).toHaveLength(1);
    // A name that is taken is not granted again.
    expect(await grant(alice, 'avatars', name)).toEqual({ status: 409, body: { error: 'exists' } });
  });

  it('gives no row to an object the bucket\'s rules do not take, however it reached the store', async () => {
    const name = `${alice.userId}/not-a-photo.jpg`;
    await store.write('avatars', name, Buffer.from('plain text'), { contentType: 'text/plain', cacheControl: null });

    expect(await call(alice.userId, 'uploads/complete', { bucket: 'avatars', name })).toEqual({ status: 415, body: { error: 'type_not_allowed' } });

    expect(await rowsOf('avatars', name)).toEqual([]);
    expect(await store.head('avatars', name)).toBeNull();
  });

  it('shows a chat attachment to the chat\'s members through a signed address, and to nobody else', async () => {
    const name = `${alice.userId}/${chatId}/photo.jpg`;
    expect((await upload(alice, 'chat-media', name)).status).toBe(200);

    const forBob = await call(bob.userId, 'signed-urls', { bucket: 'chat-media', name, expiresIn: 600 });
    expect(forBob.status).toBe(200);
    const read = await gateway.app.inject({ method: 'GET', url: pathOf(forBob.body.signedUrl) });
    expect(read.statusCode).toBe(200);
    expect(read.rawPayload.equals(PHOTO)).toBe(true);

    expect((await call(outsider.userId, 'signed-urls', { bucket: 'chat-media', name, expiresIn: 600 })).status).toBe(403);
    // A member of the chat learns that a file is not there; an outsider learns nothing either way.
    const missing = `${alice.userId}/${chatId}/never-sent.jpg`;
    expect(await call(bob.userId, 'signed-urls', { bucket: 'chat-media', name: missing, expiresIn: 600 })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await call(outsider.userId, 'signed-urls', { bucket: 'chat-media', name: missing, expiresIn: 600 })).status).toBe(403);
    expect((await call(bob.userId, 'signed-urls', { bucket: 'chat-media', name, expiresIn: 0 })).status).toBe(400);
    // A private bucket has no lasting address, and a signed address cannot be altered.
    expect((await gateway.app.inject({ method: 'GET', url: pathOf(store.publicUrl('chat-media', name)) })).statusCode).toBe(404);
    expect((await gateway.app.inject({ method: 'GET', url: `${pathOf(forBob.body.signedUrl).slice(0, -2)}xx` })).statusCode).toBe(403);
  });

  it('deletes a member\'s own files, row and bytes, and skips what is not theirs', async () => {
    const mine = `${alice.userId}/delete-me.jpg`;
    const kept = `${alice.userId}/keep-me.jpg`;
    await upload(alice, 'avatars', mine);
    await upload(alice, 'avatars', kept);

    // Bob names Alice's file: nothing is deleted and nothing is refused, as a delete that matches no row.
    expect(await call(bob.userId, 'objects/delete', { bucket: 'avatars', names: [kept] })).toEqual({ status: 200, body: { deleted: [] } });
    expect(await rowsOf('avatars', kept)).toHaveLength(1);

    expect(await call(alice.userId, 'objects/delete', { bucket: 'avatars', names: [mine, mine, `${alice.userId}/never-existed.jpg`] })).toEqual({
      status: 200,
      body: { deleted: [mine, `${alice.userId}/never-existed.jpg`] },
    });
    expect(await rowsOf('avatars', mine)).toEqual([]);
    expect(await store.head('avatars', mine)).toBeNull();
    expect((await gateway.app.inject({ method: 'GET', url: pathOf(store.publicUrl('avatars', mine)) })).statusCode).toBe(404);
    expect(await store.head('avatars', kept)).not.toBeNull();

    for (const names of [[], 'a.jpg', [7], Array(101).fill(`${alice.userId}/x.jpg`)]) {
      expect((await call(alice.userId, 'objects/delete', { bucket: 'avatars', names })).status, JSON.stringify(names).slice(0, 40)).toBe(400);
    }
  });
});
