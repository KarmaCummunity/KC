import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getSession: vi.fn(),
  refreshSession: vi.fn(),
};

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({ auth }) }));
vi.mock('../../authSecureStorage', () => ({ pickAuthStorage: () => undefined }));
/** The build's config as `expo-constants` exposes it; a test changes the version it reports. */
const constants: { expoConfig?: { version?: string } } = { expoConfig: { version: '1.6.0' } };
vi.mock('expo-constants', () => ({ default: constants }));

import type { ISavedPostsRepository } from '@kc/application';
import { rolloutBucket } from '@kc/infrastructure-api';
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

  describe('when the server serves a port to some of the app', () => {
    /** A member whose place in the savedPosts rollout is neither first nor last. */
    const memberId = ['member-1', 'member-2', 'member-3', 'member-4'].find((id) => rolloutBucket(id, 'savedPosts') % 99 !== 0) as string;
    const place = rolloutBucket(memberId, 'savedPosts');

    /** One call with the manifest carrying `rollout` for savedPosts; true when it went to the API. */
    const wentToApi = async (rollout: Record<string, unknown>) => {
      resetApiBackendForTests();
      fetchMock.mockReset();
      vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
      fetchMock.mockResolvedValueOnce(json(200, { ports: { savedPosts: ['savePost'] }, rollout: { savedPosts: rollout } })).mockResolvedValueOnce(json(200, {}));
      const { adapter, savePost } = localAdapter();
      await viaApi('savedPosts', adapter).savePost('p1');
      return savePost.mock.calls.length === 0;
    };

    beforeEach(() => {
      constants.expoConfig = { version: '1.6.0' };
      auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token-1', user: { id: memberId } } } });
    });

    it('routes the signed-in member by their place in the share', async () => {
      expect(await wentToApi({ percent: place + 1 })).toBe(true);
      expect(await wentToApi({ percent: place })).toBe(false);
    });

    it('keeps a signed-out visitor on the adapter in place until the share is everyone', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null } });

      expect(await wentToApi({ percent: 99 })).toBe(false);
      expect(await wentToApi({ percent: 100 })).toBe(true);
    });

    it('routes by the version of this build', async () => {
      expect(await wentToApi({ minAppVersion: '1.6.0' })).toBe(true);
      expect(await wentToApi({ minAppVersion: '1.6.1' })).toBe(false);

      constants.expoConfig = undefined;
      expect(await wentToApi({ minAppVersion: '0.0.1' })).toBe(false);
    });
  });

  it('does not hold up a call when the API never answers the manifest', async () => {
    vi.stubEnv('EXPO_PUBLIC_KC_API_URL', 'https://api.kc.test');
    vi.useFakeTimers();
    fetchMock.mockReturnValueOnce(new Promise(() => undefined));
    const { adapter, savePost } = localAdapter();

    const call = viaApi('savedPosts', adapter).savePost('p1');
    await vi.advanceTimersByTimeAsync(2_000);
    await call;
    vi.useRealTimers();

    expect(savePost).toHaveBeenCalledWith('p1');
  });
});
