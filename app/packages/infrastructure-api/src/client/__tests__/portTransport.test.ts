import { FollowError } from '@kc/application';
import { BackendRuleError } from '@kc/domain';
import { describe, expect, it, vi } from 'vitest';
import { serializePortError } from '../../wire/portErrors';
import { createPortTransport, PortCallError, PortTimeoutError } from '../portTransport';

interface Recorded {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

/** A fetch that answers from a queue of responses and records each request. */
function fakeFetch(...responses: Array<Response | (() => Promise<Response>)>) {
  const requests: Recorded[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), authorization: headers.get('authorization') ?? undefined, body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    return typeof next === 'function' ? next() : next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function transportWith(fetchImpl: typeof fetch, token: string | null = 'token-1') {
  const getAccessToken = vi.fn((forceRefresh: boolean) => Promise.resolve(token && forceRefresh ? 'token-2' : token));
  return { transport: createPortTransport({ baseUrl: 'https://api.kc.test', getAccessToken, fetch: fetchImpl }), getAccessToken };
}

describe('port transport', () => {
  it('posts the arguments with the bearer token and returns the result', async () => {
    const { fetchImpl, requests } = fakeFetch(json(200, { result: { followerId: 'a' } }));
    const { transport } = transportWith(fetchImpl);

    const result = await transport.call('users', 'follow', ['a', 'b', undefined]);

    expect(result).toEqual({ followerId: 'a' });
    expect(requests).toEqual([{ url: 'https://api.kc.test/v1/ports/users/follow', authorization: 'Bearer token-1', body: { args: ['a', 'b'] } }]);
  });

  it('returns undefined for a method that returns nothing, and null when the result is null', async () => {
    const { fetchImpl } = fakeFetch(json(200, {}), json(200, { result: null }), new Response('', { status: 200 }));
    const { transport } = transportWith(fetchImpl);

    expect(await transport.call('users', 'unfollow', [])).toBeUndefined();
    expect(await transport.call('users', 'findById', [])).toBeNull();
    expect(await transport.call('users', 'unfollow', [])).toBeUndefined();
  });

  it('sends no Authorization header for a signed-out visitor', async () => {
    const { fetchImpl, requests } = fakeFetch(json(200, { result: [] }));
    const { transport } = transportWith(fetchImpl, null);

    await transport.call('guestPosts', 'list', []);

    expect(requests[0]?.authorization).toBeUndefined();
  });

  it('rethrows a typed port error as an instance of its class', async () => {
    const port = serializePortError(new FollowError('cooldown_active', 'wait', { cooldownUntil: '2026-12-01T00:00:00Z' }));
    const { fetchImpl } = fakeFetch(json(422, { error: { code: 'port_error', requestId: 'r1', detail: { port } } }));
    const { transport } = transportWith(fetchImpl);

    const failure = await transport.call('users', 'sendFollowRequest', []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(FollowError);
    expect(failure).toMatchObject({ code: 'cooldown_active', cooldownUntil: '2026-12-01T00:00:00Z' });
  });

  it('refreshes the token once after a 401 and repeats the call', async () => {
    const { fetchImpl, requests } = fakeFetch(json(401, { error: { code: 'unauthorized' } }), json(200, { result: 1 }));
    const { transport, getAccessToken } = transportWith(fetchImpl);

    expect(await transport.call('users', 'isFollowing', [])).toBe(1);
    expect(requests.map((request) => request.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(getAccessToken.mock.calls).toEqual([[false], [true]]);
  });

  it('reports a caller who is still rejected after the refresh as unauthenticated, like the Supabase adapters', async () => {
    const unauthorized = () => Promise.resolve(json(401, { error: { code: 'unauthorized' } }));
    const { fetchImpl } = fakeFetch(unauthorized, unauthorized);
    const { transport } = transportWith(fetchImpl);

    const failure = await transport.call('users', 'follow', []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BackendRuleError);
    expect(failure).toMatchObject({ reason: 'unauthenticated', object: 'port:users.follow' });
  });

  it('reports any other failure with the code and request id of the API', async () => {
    const { fetchImpl } = fakeFetch(json(500, { error: { code: 'internal_error', requestId: 'req-9' } }), new Response('<html>bad gateway</html>', { status: 502 }));
    const { transport } = transportWith(fetchImpl);

    const first = await transport.call('users', 'follow', []).catch((error: unknown) => error);
    const second = await transport.call('users', 'follow', []).catch((error: unknown) => error);

    expect(first).toBeInstanceOf(PortCallError);
    expect(first).toMatchObject({ code: 'internal_error', status: 500, requestId: 'req-9' });
    expect(second).toMatchObject({ code: 'unknown_error', status: 502 });
  });

  it('aborts a call that takes too long with an error the app recognises as a timeout', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const transport = createPortTransport({ baseUrl: 'https://api.kc.test', getAccessToken: () => Promise.resolve(null), fetch: hanging, timeoutMs: 10 });

    const failure = await transport.call('users', 'follow', []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PortTimeoutError);
    expect(failure).toMatchObject({ name: 'TimeoutError', message: expect.stringContaining('timed out') });
  });

  it('lets a network failure through unchanged', async () => {
    const offline = new TypeError('Network request failed');
    const transport = createPortTransport({ baseUrl: 'https://api.kc.test', getAccessToken: () => Promise.resolve(null), fetch: () => Promise.reject(offline) });

    await expect(transport.call('users', 'follow', [])).rejects.toBe(offline);
  });
});

describe('port transport: dates', () => {
  const when = new Date('2026-11-21T10:00:00.000Z');

  it('sends a Date argument marked and flags the request', async () => {
    const { fetchImpl, requests } = fakeFetch(json(200, {}));
    const { transport } = transportWith(fetchImpl);

    await transport.call('legalDocument', 'record', [{ at: when }, 'plain']);

    expect(requests[0]?.body).toEqual({ args: [{ at: { $date: '2026-11-21T10:00:00.000Z' } }, 'plain'], typed: true });
  });

  it('does not flag a request that carries no date', async () => {
    const { fetchImpl, requests } = fakeFetch(json(200, {}));
    const { transport } = transportWith(fetchImpl);

    await transport.call('user', 'follow', ['a', 'b']);

    expect(requests[0]?.body).toEqual({ args: ['a', 'b'] });
  });

  it('turns marked dates in a flagged result back into Dates, and leaves an unflagged result alone', async () => {
    const marked = { acceptedAt: { $date: '2026-11-21T10:00:00.000Z' } };
    const { fetchImpl } = fakeFetch(json(200, { result: marked, typed: true }), json(200, { result: marked }));
    const { transport } = transportWith(fetchImpl);

    expect(await transport.call('legalDocument', 'acceptVersion', [])).toEqual({ acceptedAt: when });
    expect(await transport.call('legalDocument', 'acceptVersion', [])).toEqual(marked);
  });
});
