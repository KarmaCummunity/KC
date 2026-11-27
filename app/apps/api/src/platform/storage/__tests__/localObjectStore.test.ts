import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_STORE_PATH, LocalObjectStore, UnsafeObjectPathError } from '../localObjectStore';
import { verifyGrant } from '../storageGrants';
import { describeObjectStoreCacheControl, describeObjectStoreContract, describeObjectStorePaging, type ObjectStoreLeg } from './objectStoreContract';

const SECRET = 'store-secret';
const BASE_URL = 'http://api.kc.test';
const NOW_MS = 1_800_000_000_000;
const JPEG = { contentType: 'image/jpeg', cacheControl: 'public, max-age=60' };

/** A local store on a directory of its own, removed when the leg closes. */
async function openLocalLeg(): Promise<ObjectStoreLeg> {
  const directory = await mkdtemp(join(tmpdir(), 'kc-store-contract-'));
  const store = new LocalObjectStore({ directory, baseUrl: BASE_URL, signingSecret: SECRET });
  return { store, publicBaseUrl: BASE_URL, close: () => rm(directory, { recursive: true, force: true }) };
}

describeObjectStoreContract('local directory', openLocalLeg);
describeObjectStorePaging('local directory', openLocalLeg);
describeObjectStoreCacheControl('local directory', openLocalLeg);

// What only the local store has: a directory it must not leave, a record file
// beside each object, and signed addresses that are grants of this API.
describe('LocalObjectStore', () => {
  let directory: string;
  let store: LocalObjectStore;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kc-store-'));
    store = new LocalObjectStore({ directory, baseUrl: BASE_URL, signingSecret: SECRET, now: () => NOW_MS });
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('deletes an object together with its record', async () => {
    await store.write('chat-media', 'u1/c1/x.jpg', new Uint8Array([7]), JPEG);

    await store.delete('chat-media', 'u1/c1/x.jpg');

    expect(await readdir(join(directory, 'chat-media', 'u1', 'c1'))).toEqual([]);
  });

  it.each([
    ['avatars', '../outside.jpg'],
    ['avatars', 'u1/../../outside.jpg'],
    ['avatars', '/etc/passwd'],
    ['..', 'a.jpg'],
    ['a/b', 'a.jpg'],
  ])('refuses to touch the file system for the path %s/%s', async (bucket, name) => {
    await expect(store.write(bucket, name, new Uint8Array([1]), JPEG)).rejects.toBeInstanceOf(UnsafeObjectPathError);
    await expect(store.read(bucket, name)).rejects.toBeInstanceOf(UnsafeObjectPathError);
    await expect(store.delete(bucket, name)).rejects.toBeInstanceOf(UnsafeObjectPathError);
  });

  it('signs an upload URL that carries exactly what was granted', async () => {
    const upload = await store.signedUploadUrl({ bucket: 'avatars', name: 'u1/new.jpg', contentType: 'image/jpeg', maxBytes: 2048, cacheControl: null }, 600);

    expect(upload).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/jpeg' }, expiresAt: new Date(NOW_MS + 600_000).toISOString() });
    const token = upload.url.slice(`${BASE_URL}${LOCAL_STORE_PATH}/upload?grant=`.length);
    expect(verifyGrant(token, SECRET, NOW_MS / 1000)).toEqual({
      action: 'upload',
      bucket: 'avatars',
      name: 'u1/new.jpg',
      contentType: 'image/jpeg',
      maxBytes: 2048,
      cacheControl: null,
      expiresAt: NOW_MS / 1000 + 600,
    });
  });

  it('signs a read URL for one object and one period', async () => {
    const url = await store.signedReadUrl('chat-media', 'u1/c1/x.jpg', 60);

    const token = url.slice(`${BASE_URL}${LOCAL_STORE_PATH}/read?grant=`.length);
    expect(verifyGrant(token, SECRET, NOW_MS / 1000)).toEqual({ action: 'read', bucket: 'chat-media', name: 'u1/c1/x.jpg', expiresAt: NOW_MS / 1000 + 60 });
    expect(verifyGrant(token, SECRET, NOW_MS / 1000 + 60)).toBeNull();
  });

  describe('listing', () => {
    let listed: LocalObjectStore;
    let listDirectory: string;

    beforeAll(async () => {
      listDirectory = await mkdtemp(join(tmpdir(), 'kc-store-list-'));
      listed = new LocalObjectStore({ directory: listDirectory, baseUrl: BASE_URL, signingSecret: SECRET });
      for (const name of ['u1/a.jpg', 'u1/b/c.jpg', 'u2/y.jpg']) await listed.write('post-images', name, new Uint8Array([1, 2]), JPEG);
      await listed.write('avatars', 'u1/other-bucket.jpg', new Uint8Array([1]), JPEG);
    });

    afterAll(async () => {
      await rm(listDirectory, { recursive: true, force: true });
    });

    it('lists a whole bucket with the empty prefix: never another bucket\'s objects, never the records beside them', async () => {
      const page = await listed.list('post-images', '', { limit: 100 });

      expect(page.entries.map((entry) => entry.name)).toEqual(['u1/a.jpg', 'u1/b/c.jpg', 'u2/y.jpg']);
    });

    it('lists nothing for a bucket no object was ever stored in', async () => {
      expect((await listed.list('no-such-bucket', '', { limit: 100 })).entries).toEqual([]);
    });

    it('refuses a bucket name that could leave the store', async () => {
      await expect(listed.list('..', '', { limit: 10 })).rejects.toBeInstanceOf(UnsafeObjectPathError);
    });
  });
});
