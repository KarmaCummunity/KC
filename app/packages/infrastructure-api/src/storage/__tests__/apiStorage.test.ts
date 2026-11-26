import { describe, expect, it, vi } from 'vitest';
import { createApiStorage, StorageRequestError } from '../apiStorage';

const API = 'https://api.kc.test';
const UPLOAD_URL = 'https://files.kc.test/upload?grant=abc';
const BYTES = new Uint8Array([1, 2, 3]);
const OBJECT = { bucket: 'avatars', name: 'u1/a.jpg', bytes: BYTES, contentType: 'image/jpeg', cacheControl: 'public, max-age=60' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const granted = () => json(200, { upload: { url: UPLOAD_URL, method: 'PUT', headers: { 'content-type': 'image/jpeg' }, expiresAt: '2026-11-24T00:00:00.000Z' } });

/** A storage client whose requests are answered in order by `answers`, and recorded. */
function setup(answers: Array<Response | Error>) {
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const getAccessToken = vi.fn((forceRefresh: boolean) => Promise.resolve<string | null>(forceRefresh ? 'token-2' : 'token-1'));
  const storage = createApiStorage({ baseUrl: API, getAccessToken, fetch: fetchImpl as unknown as typeof fetch });
  const requestAt = (index: number) => {
    const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers), body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body };
  };
  return { storage, fetchImpl, getAccessToken, requestAt };
}

describe('createApiStorage', () => {
  it('uploads in three steps: grant as the member, bytes to the signed address, confirmation', async () => {
    const { storage, fetchImpl, requestAt } = setup([granted(), json(200, { ok: true }), json(200, { path: 'u1/a.jpg' })]);

    await storage.upload(OBJECT);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const grant = requestAt(0);
    expect(grant.url).toBe(`${API}/v1/storage/uploads`);
    expect(grant.headers.get('authorization')).toBe('Bearer token-1');
    expect(grant.body).toEqual({ bucket: 'avatars', name: 'u1/a.jpg', contentType: 'image/jpeg', size: 3, cacheControl: 'public, max-age=60' });
    const bytes = requestAt(1);
    expect([bytes.url, bytes.init.method, bytes.body]).toEqual([UPLOAD_URL, 'PUT', BYTES]);
    // The address is the grant: the member's token is not sent to the store.
    expect([bytes.headers.get('content-type'), bytes.headers.has('authorization')]).toEqual(['image/jpeg', false]);
    const complete = requestAt(2);
    expect([complete.url, complete.body]).toEqual([`${API}/v1/storage/uploads/complete`, { bucket: 'avatars', name: 'u1/a.jpg' }]);
  });

  it.each([
    [403, 'forbidden'],
    [409, 'exists'],
    [413, 'too_large'],
    [415, 'type_not_allowed'],
  ])('stops at a refused grant (%i %s) without sending a byte', async (status, code) => {
    const { storage, fetchImpl } = setup([json(status, { error: code })]);

    await expect(storage.upload(OBJECT)).rejects.toMatchObject({ name: 'StorageRequestError', status, code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports the store refusing the bytes and does not confirm', async () => {
    const { storage, fetchImpl } = setup([granted(), new Response('<html>bad gateway</html>', { status: 502 })]);

    await expect(storage.upload(OBJECT)).rejects.toEqual(new StorageRequestError(502, 'upload_failed'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads the code of the API\'s generic error shape too', async () => {
    const { storage } = setup([json(429, { error: { code: 'rate_limited' } })]);

    await expect(storage.upload(OBJECT)).rejects.toEqual(new StorageRequestError(429, 'rate_limited'));
  });

  it('replaces a rejected token once and sends the request again', async () => {
    const { storage, getAccessToken, requestAt } = setup([json(401, { error: { code: 'unauthorized' } }), json(200, { signedUrl: 'https://files.kc.test/read?grant=x' })]);

    const url = await storage.signedUrl({ bucket: 'chat-media', name: 'u1/c1/a.jpg' }, 600);

    expect(url).toBe('https://files.kc.test/read?grant=x');
    expect(getAccessToken.mock.calls).toEqual([[false], [true]]);
    expect(requestAt(1).headers.get('authorization')).toBe('Bearer token-2');
    expect(requestAt(1).body).toEqual({ bucket: 'chat-media', name: 'u1/c1/a.jpg', expiresIn: 600 });
  });

  it('gives up after the second rejection instead of looping', async () => {
    const { storage, fetchImpl } = setup([json(401, {}), json(401, {})]);

    await expect(storage.signedUrl({ bucket: 'chat-media', name: 'a' }, 60)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('passes the caller\'s abort signal to every request of an upload, and lets a network failure through as it is', async () => {
    const controller = new AbortController();
    const lost = new TypeError('Network request failed');
    const { storage, requestAt } = setup([granted(), lost]);

    await expect(storage.upload({ ...OBJECT, signal: controller.signal })).rejects.toBe(lost);

    expect([requestAt(0).init.signal, requestAt(1).init.signal]).toEqual([controller.signal, controller.signal]);
  });

  it('deletes by name and returns what the server removed; an empty list asks nothing', async () => {
    const { storage, fetchImpl, requestAt } = setup([json(200, { deleted: ['u1/a.jpg'] })]);

    expect(await storage.remove('avatars', ['u1/a.jpg', 'u2/b.jpg'])).toEqual(['u1/a.jpg']);
    expect(await storage.remove('avatars', [])).toEqual([]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([requestAt(0).url, requestAt(0).body]).toEqual([`${API}/v1/storage/objects/delete`, { bucket: 'avatars', names: ['u1/a.jpg', 'u2/b.jpg'] }]);
  });
});
