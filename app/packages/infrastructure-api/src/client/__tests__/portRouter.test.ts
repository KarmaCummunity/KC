import type { ISavedPostsRepository } from '@kc/application';
import { describe, expect, it, vi } from 'vitest';
import { createPortRouter } from '../portRouter';
import type { PortTransport } from '../portTransport';

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

function setup(manifest: (() => Response | Promise<Response>) | Response, ttl = 60_000) {
  const transportCall = vi.fn(() => Promise.resolve('remote'));
  const fetchImpl = vi.fn(() => Promise.resolve(typeof manifest === 'function' ? manifest() : manifest.clone()));
  let clock = 0;
  const router = createPortRouter({
    transport: { call: transportCall } as unknown as PortTransport,
    baseUrl: 'https://api.kc.test',
    fetch: fetchImpl as unknown as typeof fetch,
    manifestTtlMs: ttl,
    now: () => clock,
  });
  return { router, transportCall, fetchImpl, advance: (ms: number) => (clock += ms) };
}

const manifestOf = (ports: Record<string, string[]>) => new Response(JSON.stringify({ ports }), { status: 200 });

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
    expect(fetchImpl).toHaveBeenCalledWith('https://api.kc.test/v1/ports');
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
