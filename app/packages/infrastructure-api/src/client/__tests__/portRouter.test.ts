import type { ISavedPostsRepository } from '@kc/application';
import { describe, expect, it, vi } from 'vitest';
import { createPortRouter, type PortRouterOptions } from '../portRouter';
import { rolloutBucket } from '../portRollout';
import type { PortTransport } from '../portTransport';
import type { PortRollout } from '../../wire/portWire';

/** The adapter in place: answers "local" and records what reached it. */
function localAdapter() {
  const calls: string[] = [];
  const adapter = {
    label: 'local',
    savePost: (postId: string) => {
      calls.push(`savePost:${postId}`);
      return Promise.resolve();
    },
    unsavePost: () => Promise.resolve(),
    isPostSaved: function (this: { label: string }) {
      // Proves the fallback is called on the adapter itself, so `this` works.
      return Promise.resolve(this.label === 'local');
    },
    listSavedPosts: () => Promise.resolve({ items: [], nextCursor: null }),
  };
  return { adapter: adapter as unknown as ISavedPostsRepository, calls };
}

function setup(manifest: (() => Response | Promise<Response>) | Response, ttl = 60_000, extra: Partial<PortRouterOptions> = {}) {
  const transportCall = vi.fn(() => Promise.resolve('remote'));
  // Typed with fetch's own parameters so a test can read the request it was given.
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(typeof manifest === 'function' ? manifest() : manifest.clone()));
  let clock = 0;
  const router = createPortRouter({
    transport: { call: transportCall } as unknown as PortTransport,
    baseUrl: 'https://api.kc.test',
    fetch: fetchImpl as unknown as typeof fetch,
    manifestTtlMs: ttl,
    now: () => clock,
    ...extra,
  });
  return { router, transportCall, fetchImpl, advance: (ms: number) => (clock += ms) };
}

const manifestOf = (ports: Record<string, string[]>, rollout?: Record<string, PortRollout>) => new Response(JSON.stringify({ ports, rollout }), { status: 200 });

describe('createPortRouter', () => {
  it('sends a served method to the API and the others to the adapter in place', async () => {
    const { router, transportCall, fetchImpl } = setup(manifestOf({ savedPosts: ['savePost'] }));
    const { adapter, calls } = localAdapter();
    const saved = router.port('savedPosts', adapter);

    await saved.savePost('p1');
    const local = await saved.isPostSaved('p1');

    expect(transportCall).toHaveBeenCalledWith('savedPosts', 'savePost', ['p1']);
    expect(local).toBe(true);
    expect(calls).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.kc.test/v1/ports', { signal: expect.any(AbortSignal) });
  });

  it('uses the adapter in place for a port the API does not list', async () => {
    const { router, transportCall } = setup(manifestOf({ user: ['follow'] }));
    const { adapter, calls } = localAdapter();

    await router.port('savedPosts', adapter).savePost('p1');

    expect(calls).toEqual(['savePost:p1']);
    expect(transportCall).not.toHaveBeenCalled();
  });

  it.each([
    ['is unreachable', () => Promise.reject(new TypeError('Network request failed'))],
    ['answers an error', () => new Response('nope', { status: 503 })],
    ['answers something that is not a manifest', () => new Response('{}', { status: 200 })],
  ])('keeps working on the adapters in place when the API %s', async (_case, manifest) => {
    const { router, transportCall } = setup(manifest as () => Promise<Response>);
    const { adapter, calls } = localAdapter();

    await router.port('savedPosts', adapter).savePost('p1');

    expect(calls).toEqual(['savePost:p1']);
    expect(transportCall).not.toHaveBeenCalled();
  });

  it('fetches the manifest once for concurrent calls and reuses it until it expires', async () => {
    const { router, fetchImpl, advance } = setup(manifestOf({ savedPosts: ['savePost'] }), 1000);
    const saved = router.port('savedPosts', localAdapter().adapter);

    await Promise.all([saved.savePost('a'), saved.savePost('b'), saved.savePost('c')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    advance(1001);
    await saved.savePost('d');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('picks up a port the server starts or stops serving, without a new build', async () => {
    let ports: Record<string, string[]> = {};
    const { router, transportCall, advance } = setup(() => manifestOf(ports), 1000);
    const { adapter, calls } = localAdapter();
    const saved = router.port('savedPosts', adapter);

    await saved.savePost('before');
    ports = { savedPosts: ['savePost'] };
    advance(1001);
    // The refresh runs in the background: this call still uses the manifest it has.
    await saved.savePost('during');
    // Let the background refresh land before the next call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await saved.savePost('after');

    expect(calls).toEqual(['savePost:before', 'savePost:during']);
    expect(transportCall).toHaveBeenCalledTimes(1);
  });

  it('waits before asking a failing API again', async () => {
    const { router, fetchImpl, advance } = setup(() => new Response('', { status: 500 }));
    const saved = router.port('savedPosts', localAdapter().adapter);

    await saved.savePost('a');
    await saved.savePost('b');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    advance(30_001);
    await saved.savePost('c');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('leaves fields of the adapter alone and gives each method one stable function', () => {
    const { router } = setup(manifestOf({}));
    const saved = router.port('savedPosts', localAdapter().adapter);

    expect((saved as unknown as { label: string }).label).toBe('local');
    expect(saved.savePost).toBe(saved.savePost);
  });
});

describe('createPortRouter with an API that does not answer', () => {
  /** A manifest request that never settles, as a host that accepts the connection and goes silent. */
  const hanging = () => new Promise<Response>(() => undefined);

  it('serves the first call from the adapter in place once the bound has passed', async () => {
    const { router, transportCall, fetchImpl } = setup(hanging, 60_000, { manifestTimeoutMs: 20 });
    const { adapter, calls } = localAdapter();
    const startedAt = Date.now();

    await router.port('savedPosts', adapter).savePost('p1');

    expect(calls).toEqual(['savePost:p1']);
    expect(transportCall).not.toHaveBeenCalled();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    // The abandoned request was told to stop, not left to run.
    expect((fetchImpl.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it('does not make later calls wait again: the next attempt comes after the retry delay', async () => {
    const { router, fetchImpl, advance } = setup(hanging, 60_000, { manifestTimeoutMs: 20 });
    const saved = router.port('savedPosts', localAdapter().adapter);

    await saved.savePost('a');
    const startedAt = Date.now();
    await saved.savePost('b');

    expect(Date.now() - startedAt).toBeLessThan(15);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(30_001);
    await saved.savePost('c');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses a manifest that arrives within the bound', async () => {
    const slow = () => new Promise<Response>((resolve) => setTimeout(() => resolve(manifestOf({ savedPosts: ['savePost'] })), 10));
    const { router, transportCall } = setup(slow, 60_000, { manifestTimeoutMs: 500 });

    await router.port('savedPosts', localAdapter().adapter).savePost('p1');

    expect(transportCall).toHaveBeenCalledTimes(1);
  });
});

describe('createPortRouter with a rollout', () => {
  const PORTS = { savedPosts: ['savePost'] };
  /** Two member ids on either side of a 50% share of the savedPosts port. */
  const memberIn = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].find((id) => rolloutBucket(id, 'savedPosts') < 50) as string;
  const memberOut = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].find((id) => rolloutBucket(id, 'savedPosts') >= 50) as string;

  const routed = async (rollout: PortRollout, extra: Partial<PortRouterOptions>) => {
    const { router, transportCall } = setup(manifestOf(PORTS, { savedPosts: rollout }), 60_000, extra);
    await router.port('savedPosts', localAdapter().adapter).savePost('p1');
    return transportCall.mock.calls.length === 1;
  };

  it('serves a share of the members: the member inside it goes to the API, the one outside stays', async () => {
    expect(await routed({ percent: 50 }, { getMemberId: () => Promise.resolve(memberIn) })).toBe(true);
    expect(await routed({ percent: 50 }, { getMemberId: () => Promise.resolve(memberOut) })).toBe(false);
  });

  it('keeps a visitor, and an app that cannot tell who the member is, on the adapter in place below 100', async () => {
    expect(await routed({ percent: 99 }, { getMemberId: () => Promise.resolve(null) })).toBe(false);
    expect(await routed({ percent: 99 }, {})).toBe(false);
    expect(await routed({ percent: 99 }, { getMemberId: () => Promise.reject(new Error('session store unavailable')) })).toBe(false);
  });

  it('does not ask who the member is when the answer cannot depend on it', async () => {
    const getMemberId = vi.fn(() => Promise.resolve(memberIn));

    expect(await routed({ percent: 100 }, { getMemberId })).toBe(true);
    expect(await routed({ percent: 0 }, { getMemberId })).toBe(false);
    expect(getMemberId).not.toHaveBeenCalled();
  });

  it('serves a port only from the app version the server names', async () => {
    expect(await routed({ minAppVersion: '1.6.0' }, { getAppVersion: () => Promise.resolve('1.6.0') })).toBe(true);
    expect(await routed({ minAppVersion: '1.6.0' }, { getAppVersion: () => Promise.resolve('1.5.9') })).toBe(false);
    // A build that does not know its own version is treated as too old.
    expect(await routed({ minAppVersion: '1.6.0' }, {})).toBe(false);
    expect(await routed({ minAppVersion: '1.6.0' }, { getAppVersion: () => Promise.reject(new Error('no config')) })).toBe(false);
  });

  it('reads the app version once, and not at all for a port with no version rule', async () => {
    const getAppVersion = vi.fn(() => Promise.resolve('1.6.0'));
    const { router } = setup(manifestOf({ savedPosts: ['savePost', 'unsavePost'], user: ['follow'] }, { savedPosts: { minAppVersion: '1.0.0' } }), 60_000, { getAppVersion });
    const saved = router.port('savedPosts', localAdapter().adapter);

    await saved.savePost('a');
    await saved.unsavePost('a');

    expect(getAppVersion).toHaveBeenCalledTimes(1);
  });

  it('applies both rules together and leaves a port without a rule served to everyone', async () => {
    expect(await routed({ percent: 50, minAppVersion: '2.0.0' }, { getAppVersion: () => Promise.resolve('1.9.0'), getMemberId: () => Promise.resolve(memberIn) })).toBe(false);
    expect(await routed({ percent: 50, minAppVersion: '2.0.0' }, { getAppVersion: () => Promise.resolve('2.0.1'), getMemberId: () => Promise.resolve(memberIn) })).toBe(true);

    const { router, transportCall } = setup(manifestOf(PORTS, { user: { percent: 0 } }));
    await router.port('savedPosts', localAdapter().adapter).savePost('p1');
    expect(transportCall).toHaveBeenCalledTimes(1);
  });
});

