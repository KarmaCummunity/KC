import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeObjectStoreContract } from './objectStoreContract';
import { type GcsTestLeg, openEmulatorLeg } from './gcsTestLeg';

// `GcsObjectStore` against the Cloud Storage emulator: the SDK calls it makes
// are real HTTP requests that the emulator answers as the service does.
// Collected only when KC_API_TEST_GCS_ENDPOINT names an emulator
// (vitest.config.ts); the backend CI lane starts one.
//
// What the emulator does not do, and so is not asserted here: it answers a
// listing in one page, does not record Cache-Control, and accepts any upload
// to a signed address (it checks neither the signature nor the signed
// conditions). Those are checked on a real project by
// `gcsObjectStore.cloud.integration.test.ts`.

const ENDPOINT = process.env.KC_API_TEST_GCS_ENDPOINT as string;
const openLeg = () => openEmulatorLeg(ENDPOINT);

describeObjectStoreContract('Cloud Storage (emulator)', openLeg);

describe('GcsObjectStore (emulator)', () => {
  let leg: GcsTestLeg;

  beforeAll(async () => {
    leg = await openLeg();
  });

  afterAll(async () => {
    await leg.close();
  });

  it('signs an upload address whose conditions are the grant: the type, the largest size, a free name, the cache rule', async () => {
    const upload = await leg.store.signedUploadUrl({ bucket: 'avatars', name: 'u1/new.jpg', contentType: 'image/jpeg', maxBytes: 2048, cacheControl: 'public, max-age=60' }, 600);

    expect(upload.method).toBe('PUT');
    expect(upload.headers).toEqual({
      'content-type': 'image/jpeg',
      'x-goog-if-generation-match': '0',
      'x-goog-content-length-range': '0,2048',
      'cache-control': 'public, max-age=60',
    });
    const url = new URL(upload.url);
    expect(url.pathname).toBe(`/${leg.bucketPrefix}avatars/u1/new.jpg`);
    // Every header the client must send is part of what was signed, so the store refuses an upload without it.
    expect(url.searchParams.get('X-Goog-SignedHeaders')?.split(';').sort()).toEqual(['cache-control', 'content-type', 'host', 'x-goog-content-length-range', 'x-goog-if-generation-match']);
    expect(url.searchParams.get('X-Goog-Expires')).toBe('600');
    expect(Math.abs(Date.parse(upload.expiresAt) - (Date.now() + 600_000))).toBeLessThan(5_000);
  });

  it('signs no cache rule when the grant has none', async () => {
    const upload = await leg.store.signedUploadUrl({ bucket: 'avatars', name: 'u1/plain.jpg', contentType: 'image/jpeg', maxBytes: 10, cacheControl: null }, 60);

    expect(Object.keys(upload.headers).sort()).toEqual(['content-type', 'x-goog-content-length-range', 'x-goog-if-generation-match']);
  });

  it('stores what a client sends to a signed upload address, under the granted name and type', async () => {
    const upload = await leg.store.signedUploadUrl({ bucket: 'post-images', name: 'u1/p1/photo.jpg', contentType: 'image/jpeg', maxBytes: 1024, cacheControl: null }, 60);

    const response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: new Uint8Array([5, 6, 7]) });

    expect(response.status).toBe(200);
    // The checksum is the store's own, of bytes it received from a client and not from this server.
    expect(await leg.store.head('post-images', 'u1/p1/photo.jpg')).toMatchObject({ size: 3, contentType: 'image/jpeg', md5: '7f3f475c2226024677d239d6580b3a0d' });
  });

  it('serves a private object from a signed read address, for the period asked', async () => {
    await leg.store.write('chat-media', 'u1/c1/x.jpg', new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg', cacheControl: null });

    const url = await leg.store.signedReadUrl('chat-media', 'u1/c1/x.jpg', 90);
    const response = await fetch(url);

    expect(new URL(url).searchParams.get('X-Goog-Expires')).toBe('90');
    expect([response.status, response.headers.get('content-type')]).toEqual([200, 'image/jpeg']);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('fails loudly for a bucket that does not exist: a missing bucket is a deployment error, not an empty store', async () => {
    await expect(leg.store.list('no-such-bucket', '', { limit: 10 })).rejects.toMatchObject({ code: 404 });
    await expect(leg.store.write('no-such-bucket', 'a.jpg', new Uint8Array([1]), { contentType: 'image/jpeg', cacheControl: null })).rejects.toMatchObject({ code: 404 });
  });
});
