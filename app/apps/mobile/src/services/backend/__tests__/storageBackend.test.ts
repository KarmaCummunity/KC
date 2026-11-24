import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bucket, client, publicEnv } = vi.hoisted(() => {
  const bucket = { createSignedUrl: vi.fn(), remove: vi.fn() };
  return {
    bucket,
    client: { auth: { getSession: vi.fn(), refreshSession: vi.fn() }, storage: { from: vi.fn(() => bucket) } },
    publicEnv: { value: { url: 'https://p.supabase.co/', anonKey: 'anon-key' } as { url: string; anonKey: string } | null },
  };
});

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../../authSecureStorage', () => ({ pickAuthStorage: () => undefined }));
vi.mock('../../../lib/supabasePublicConfig', () => ({ getSupabasePublicEnv: () => publicEnv.value }));

import { resetApiBackendForTests } from '../apiBackend';
import {
  type FileToSend,
  isPublicFileUrl,
  openFileStore,
  publicFilePath,
  publicFileUrl,
  removeFiles,
  resetStorageBackendForTests,
  resizedImageUrl,
  resizesImagesOnRequest,
  signedInMemberId,
  signFileUrl,
  StorageHttpError,
} from '../storageBackend';

const API = 'https://api.kc.test';
const BYTES = new Uint8Array([1, 2, 3]);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fileOf = (signal = new AbortController().signal): FileToSend => ({ bucket: 'avatars', path: 'u1/a b.jpg', bytes: BYTES, contentType: 'image/jpeg', cacheControl: 'public, max-age=60', signal });

describe('storage door', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const requestAt = (index: number) => {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers), body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body };
  };

  beforeEach(() => {
    resetApiBackendForTests();
    resetStorageBackendForTests();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    publicEnv.value = { url: 'https://p.supabase.co/', anonKey: 'anon-key' };
    client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'member-jwt', user: { id: 'u1' } } } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('on Supabase Storage (the default)', () => {
    it('builds a public address on the Supabase host, and none when the app is not configured', () => {
      expect(publicFileUrl('avatars', 'u1/a.jpg')).toBe('https://p.supabase.co/storage/v1/object/public/avatars/u1/a.jpg');

      publicEnv.value = null;
      expect(publicFileUrl('avatars', 'u1/a.jpg')).toBe('');
    });

    it('offers the host\'s resized copies', () => {
      expect(resizesImagesOnRequest()).toBe(true);
      expect(resizedImageUrl('post-images', 'u1/a.jpg', 'width=400&quality=80')).toBe('https://p.supabase.co/storage/v1/render/image/public/post-images/u1/a.jpg?width=400&quality=80');
    });

    it('stays on Supabase when the API is configured for data only', () => {
      vi.stubEnv('EXPO_PUBLIC_KC_API_URL', API);

      expect(publicFileUrl('avatars', 'u1/a.jpg')).toContain('p.supabase.co');
    });

    it('sends a file as the member, without upsert, and with the caller\'s abort signal', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { Key: 'avatars/u1/a b.jpg' }));
      const controller = new AbortController();

      await (await openFileStore())(fileOf(controller.signal));

      const sent = requestAt(0);
      expect([sent.url, sent.init.method, sent.body, sent.init.signal]).toEqual(['https://p.supabase.co/storage/v1/object/avatars/u1/a%20b.jpg', 'POST', BYTES, controller.signal]);
      expect(Object.fromEntries(sent.headers)).toEqual({
        authorization: 'Bearer member-jwt',
        apikey: 'anon-key',
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=60',
        'x-upsert': 'false',
      });
    });

    it('turns an error answer into a StorageHttpError with the store\'s own message, or the status line', async () => {
      fetchMock.mockResolvedValueOnce(json(413, { message: 'The object exceeded the maximum allowed size' })).mockResolvedValueOnce(new Response('<html>', { status: 502 }));
      const send = await openFileStore();

      await expect(send(fileOf())).rejects.toEqual(new StorageHttpError(413, 'The object exceeded the maximum allowed size'));
      await expect(send(fileOf())).rejects.toEqual(new StorageHttpError(502, 'HTTP 502'));
    });

    it('refuses to open before any byte is sent when the app is not configured or nobody is signed in', async () => {
      client.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
      await expect(openFileStore()).rejects.toEqual(new StorageHttpError(401, 'not_authenticated'));

      publicEnv.value = null;
      await expect(openFileStore()).rejects.toEqual(new StorageHttpError(500, 'storage_not_configured'));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('signs a private file\'s address, and answers null when the store refuses', async () => {
      bucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://p.supabase.co/sign/x?token=t' }, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

      expect(await signFileUrl('chat-media', 'u1/c1/a.jpg', 600)).toBe('https://p.supabase.co/sign/x?token=t');
      expect(await signFileUrl('chat-media', 'u1/c1/missing.jpg', 600)).toBeNull();
      expect(client.storage.from).toHaveBeenCalledWith('chat-media');
      expect(bucket.createSignedUrl).toHaveBeenCalledWith('u1/c1/a.jpg', 600);
    });

    it('deletes files, and reports why when the store does not accept the request', async () => {
      bucket.remove.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'gone' } });

      expect(await removeFiles('avatars', ['u1/a.jpg', 'u1/a-thumb.jpg'])).toBeNull();
      expect(await removeFiles('avatars', ['u1/b.jpg'])).toBe('gone');
      expect(bucket.remove).toHaveBeenCalledWith(['u1/a.jpg', 'u1/a-thumb.jpg']);
    });
  });

  describe('on KC\'s own storage', () => {
    beforeEach(() => {
      vi.stubEnv('EXPO_PUBLIC_KC_API_URL', API);
      vi.stubEnv('EXPO_PUBLIC_KC_API_STORAGE', '1');
    });

    it('builds a public address on the media domain, or on the API when none is set, in the same shape', () => {
      expect(publicFileUrl('avatars', 'u1/a.jpg')).toBe(`${API}/storage/v1/object/public/avatars/u1/a.jpg`);

      vi.stubEnv('EXPO_PUBLIC_KC_MEDIA_URL', 'https://media.kc.test/');
      expect(publicFileUrl('avatars', 'u1/a.jpg')).toBe('https://media.kc.test/storage/v1/object/public/avatars/u1/a.jpg');
    });

    it('has no resized copies made on request', () => {
      expect(resizesImagesOnRequest()).toBe(false);
      expect(resizedImageUrl('post-images', 'u1/a.jpg', 'width=400')).toBeNull();
    });

    it('sends a file in three steps: grant, bytes to the signed address, confirmation', async () => {
      fetchMock
        .mockResolvedValueOnce(json(200, { upload: { url: 'https://files.kc.test/up?grant=g', method: 'PUT', headers: { 'content-type': 'image/jpeg' }, expiresAt: '2026-11-25T00:00:00.000Z' } }))
        .mockResolvedValueOnce(json(200, { ok: true }))
        .mockResolvedValueOnce(json(200, { path: 'u1/a b.jpg' }));
      const controller = new AbortController();

      await (await openFileStore())(fileOf(controller.signal));

      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${API}/v1/storage/uploads`, 'https://files.kc.test/up?grant=g', `${API}/v1/storage/uploads/complete`]);
      expect(requestAt(0).body).toEqual({ bucket: 'avatars', name: 'u1/a b.jpg', contentType: 'image/jpeg', size: 3, cacheControl: 'public, max-age=60' });
      expect(requestAt(0).headers.get('authorization')).toBe('Bearer member-jwt');
      expect([requestAt(1).init.method, requestAt(1).body, requestAt(1).init.signal]).toEqual(['PUT', BYTES, controller.signal]);
      // Supabase Storage is not asked for anything.
      expect(client.storage.from).not.toHaveBeenCalled();
    });

    it('turns a refusal into the same StorageHttpError the callers already handle', async () => {
      fetchMock.mockResolvedValueOnce(json(415, { error: 'type_not_allowed' }));

      await expect((await openFileStore())(fileOf())).rejects.toEqual(new StorageHttpError(415, 'type_not_allowed'));
    });

    it('lets a network failure through as it is, so the caller can tell it from an answer', async () => {
      const lost = new TypeError('Network request failed');
      fetchMock.mockRejectedValueOnce(lost);

      await expect((await openFileStore())(fileOf())).rejects.toBe(lost);
    });

    it('opens without the Supabase address, and still refuses a signed-out member', async () => {
      publicEnv.value = null;
      await expect(openFileStore()).resolves.toBeTypeOf('function');

      client.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
      await expect(openFileStore()).rejects.toEqual(new StorageHttpError(401, 'not_authenticated'));
    });

    it('asks the API for a signed address, and answers null when it is refused or the file is gone', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { signedUrl: 'https://files.kc.test/read?grant=r' })).mockResolvedValueOnce(json(404, { error: 'not_found' }));

      expect(await signFileUrl('chat-media', 'u1/c1/a.jpg', 600)).toBe('https://files.kc.test/read?grant=r');
      expect(await signFileUrl('chat-media', 'u1/c1/missing.jpg', 600)).toBeNull();
      expect([requestAt(0).url, requestAt(0).body]).toEqual([`${API}/v1/storage/signed-urls`, { bucket: 'chat-media', name: 'u1/c1/a.jpg', expiresIn: 600 }]);
    });

    it('asks the API to delete, and reports the code of a refused request', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { deleted: ['u1/a.jpg'] })).mockResolvedValueOnce(json(503, { error: 'not_configured' }));

      expect(await removeFiles('avatars', ['u1/a.jpg'])).toBeNull();
      expect(await removeFiles('avatars', ['u1/b.jpg'])).toBe('not_configured');
      expect([requestAt(0).url, requestAt(0).body]).toEqual([`${API}/v1/storage/objects/delete`, { bucket: 'avatars', names: ['u1/a.jpg'] }]);
    });
  });

  it('reads the path back from a public address written on either host', () => {
    expect(publicFilePath('https://p.supabase.co/storage/v1/object/public/avatars/u1/a.jpg?v=3', 'avatars')).toBe('u1/a.jpg');
    expect(publicFilePath('https://media.kc.test/storage/v1/object/public/avatars/u1/a.jpg', 'avatars')).toBe('u1/a.jpg');
    expect(publicFilePath('https://media.kc.test/storage/v1/object/public/post-images/u1/a.jpg', 'avatars')).toBeNull();
    expect([isPublicFileUrl('https://x.test/storage/v1/object/public/avatars/a.jpg'), isPublicFileUrl('file:///a.jpg')]).toEqual([true, false]);
  });

  it('tells who is signed in', async () => {
    expect(await signedInMemberId()).toBe('u1');

    client.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await signedInMemberId()).toBeNull();
  });
});
