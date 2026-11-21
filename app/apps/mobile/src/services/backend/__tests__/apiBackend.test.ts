import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getSession: vi.fn(),
  refreshSession: vi.fn(),
};

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({ auth }) }));
vi.mock('../../authSecureStorage', () => ({ pickAuthStorage: () => undefined }));

import type { ISavedPostsRepository } from '@kc/application';
import { getApiBaseUrl, resetApiBackendForTests, viaApi } from '../apiBackend';

/** The adapter in place: records the calls that reach it. */
function localAdapter() {
  const savePost = vi.fn(() => Promise.resolve());
  const adapter = {
    savePost,
    unsavePost: vi.fn(() => Promise.resolve()),
    isPostSaved: vi.fn(() => Promise.resolve(false)),
    listSavedPosts: vi.fn(),
  } as unknown as ISavedPostsRepository;
  return { adapter, savePost };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('viaApi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetApiBackendForTests();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
    auth.refreshSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-2' } } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns the adapter untouched when no API is configured', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', '');
    const { adapter, savePost } = localAdapter();

    const port = viaApi('savedPosts', adapter);
    await port.savePost('p1');

    expect(port).toBe(adapter);
    expect(savePost).toHaveBeenCalledWith('p1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the API base URL without its trailing slash', () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', ' https://api.kc.test/ ');

    expect(getApiBaseUrl()).toBe('https://api.kc.test');
  });

  it('sends a served method to the API with the session token', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    fetchMock.mockResolvedValueOnce(json(200, { ports: { savedPosts: ['savePost'] } })).mockResolvedValueOnce(json(200, {}));
    const { adapter, savePost } = localAdapter();

    await viaApi('savedPosts', adapter).savePost('p1');

    expect(savePost).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.kc.test/v1/ports/savedPosts/savePost');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-1');
    expect(JSON.parse(String(init.body))).toEqual({ args: ['p1'] });
  });

  it('keeps a method the API does not serve on the adapter in place', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    fetchMock.mockResolvedValueOnce(json(200, { ports: { savedPosts: ['isPostSaved'] } }));
    const { adapter, savePost } = localAdapter();

    await viaApi('savedPosts', adapter).savePost('p1');

    expect(savePost).toHaveBeenCalledWith('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the adapter in place when the API cannot be reached', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { adapter, savePost } = localAdapter();

    await viaApi('savedPosts', adapter).savePost('p1');

    expect(savePost).toHaveBeenCalledWith('p1');
  });

  it('refreshes the Supabase session once when the API rejects the token', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    fetchMock
      .mockResolvedValueOnce(json(200, { ports: { savedPosts: ['savePost'] } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'unauthorized' } }))
      .mockResolvedValueOnce(json(200, {}));

    await viaApi('savedPosts', localAdapter().adapter).savePost('p1');

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    const retry = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(new Headers(retry[1].headers).get('authorization')).toBe('Bearer token-2');
  });

  it('calls the API without a token for a signed-out visitor', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValueOnce(json(200, { ports: { savedPosts: ['savePost'] } })).mockResolvedValueOnce(json(200, {}));

    await viaApi('savedPosts', localAdapter().adapter).savePost('p1');

    const call = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(call[1].headers).has('authorization')).toBe(false);
  });
});
