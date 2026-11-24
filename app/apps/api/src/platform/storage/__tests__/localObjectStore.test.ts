import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_STORE_PATH, LocalObjectStore, UnsafeObjectPathError } from '../localObjectStore';
import { verifyGrant } from '../storageGrants';

const SECRET = 'store-secret';
const BASE_URL = 'http://api.kc.test';
const NOW_MS = 1_800_000_000_000;
const JPEG = { contentType: 'image/jpeg', cacheControl: 'public, max-age=60' };

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

  it('stores an object and gives back its bytes, size and type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    expect(await store.write('avatars', 'u1/a.jpg', bytes, JPEG)).toBe(true);

    expect(await store.head('avatars', 'u1/a.jpg')).toEqual({ size: 4, ...JPEG });
    expect(Array.from((await store.read('avatars', 'u1/a.jpg')) ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('never replaces an object: the second write of a name is refused and the first bytes stay', async () => {
    await store.write('avatars', 'u1/once.jpg', new Uint8Array([1]), JPEG);

    expect(await store.write('avatars', 'u1/once.jpg', new Uint8Array([9, 9]), JPEG)).toBe(false);
    expect(Array.from((await store.read('avatars', 'u1/once.jpg')) ?? [])).toEqual([1]);
  });

  it('knows nothing of an object that was never written, and deleting it is not an error', async () => {
    expect(await store.head('avatars', 'u1/missing.jpg')).toBeNull();
    expect(await store.read('avatars', 'u1/missing.jpg')).toBeNull();
    await expect(store.delete('avatars', 'u1/missing.jpg')).resolves.toBeUndefined();
  });

  it('deletes an object together with its record', async () => {
    await store.write('chat-media', 'u1/c1/x.jpg', new Uint8Array([7]), JPEG);

    await store.delete('chat-media', 'u1/c1/x.jpg');

    expect(await store.head('chat-media', 'u1/c1/x.jpg')).toBeNull();
    expect(await readdir(join(directory, 'chat-media', 'u1', 'c1'))).toEqual([]);
  });

  it('keeps two buckets apart: the same name is two objects', async () => {
    await store.write('avatars', 'u2/same.jpg', new Uint8Array([1]), JPEG);
    await store.write('post-images', 'u2/same.jpg', new Uint8Array([2]), JPEG);

    expect(Array.from((await store.read('avatars', 'u2/same.jpg')) ?? [])).toEqual([1]);
    expect(Array.from((await store.read('post-images', 'u2/same.jpg')) ?? [])).toEqual([2]);
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

  it('builds a public URL with every path segment escaped', () => {
    expect(store.publicUrl('avatars', 'u1/my photo#1.jpg')).toBe(`${BASE_URL}${LOCAL_STORE_PATH}/public/avatars/u1/my%20photo%231.jpg`);
  });
});
