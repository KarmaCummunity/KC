import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTimeoutFetch,
  DEFAULT_SUPABASE_TIMEOUT_MS,
  FetchTimeoutError,
  isTimeoutError,
} from '../timeoutFetch';

describe('createTimeoutFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves immediately when baseFetch resolves within timeout', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);

    const timeoutFetch = createTimeoutFetch(5000, mockFetch as unknown as typeof fetch);
    const promise = timeoutFetch('https://api.example.com/data');

    await expect(promise).resolves.toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clears the timer on successful fetch so no background timeout fires', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const timeoutFetch = createTimeoutFetch(5000, mockFetch as unknown as typeof fetch);
    await timeoutFetch('https://api.example.com/data');

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('aborts and throws FetchTimeoutError when request exceeds timeoutMs', async () => {
    const hangingFetch = vi.fn().mockImplementation((_input, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('Aborted'));
        });
      });
    });

    const timeoutFetch = createTimeoutFetch(1000, hangingFetch as unknown as typeof fetch);
    const promise = timeoutFetch('https://api.example.com/slow');

    // Attach rejection handler early to prevent unhandled rejection during fake-timer advancement
    let caughtError: unknown;
    promise.catch((err) => {
      caughtError = err;
    });

    await vi.advanceTimersByTimeAsync(1001);

    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
    expect((caughtError as Error).message).toContain('timed out after 1000ms');
    expect(isTimeoutError(caughtError)).toBe(true);
  });

  it('respects caller-provided abort signal when caller cancels first', async () => {
    const callerController = new AbortController();
    const callerReason = new Error('User navigated away');

    const hangingFetch = vi.fn().mockImplementation((_input, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('Aborted'));
        });
      });
    });

    const timeoutFetch = createTimeoutFetch(5000, hangingFetch as unknown as typeof fetch);
    const promise = timeoutFetch('https://api.example.com/slow', {
      signal: callerController.signal,
    });

    let caughtError: unknown;
    promise.catch((err) => {
      caughtError = err;
    });

    callerController.abort(callerReason);

    await expect(promise).rejects.toBe(callerReason);
    expect(isTimeoutError(caughtError)).toBe(false);
  });

  it('immediately aborts if caller signal was already aborted before calling fetch', async () => {
    const callerController = new AbortController();
    callerController.abort(new Error('Already cancelled'));

    const mockFetch = vi.fn().mockImplementation((_input, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(init.signal.reason);
      }
      return Promise.resolve(new Response('ok'));
    });

    const timeoutFetch = createTimeoutFetch(5000, mockFetch as unknown as typeof fetch);
    await expect(
      timeoutFetch('https://api.example.com/data', { signal: callerController.signal }),
    ).rejects.toThrow('Already cancelled');
  });

  it('propagates normal non-timeout fetch errors without wrapping', async () => {
    const networkError = new TypeError('Failed to fetch');
    const mockFetch = vi.fn().mockRejectedValue(networkError);

    const timeoutFetch = createTimeoutFetch(5000, mockFetch as unknown as typeof fetch);
    await expect(timeoutFetch('https://api.example.com/fail')).rejects.toBe(networkError);
  });

  it('bypasses timeout logic when timeoutMs <= 0', async () => {
    const mockResponse = new Response('ok');
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);

    const timeoutFetch = createTimeoutFetch(0, mockFetch as unknown as typeof fetch);
    const res = await timeoutFetch('https://api.example.com/no-timeout');

    expect(res).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/no-timeout', undefined);
  });

  it('exposes DEFAULT_SUPABASE_TIMEOUT_MS constant (25s)', () => {
    expect(DEFAULT_SUPABASE_TIMEOUT_MS).toBe(25_000);
  });
});

describe('isLongRunningRequest', () => {
  it('skips the timeout for storage and edge function calls', async () => {
    const { isLongRunningRequest, createTimeoutFetch } = await import('../timeoutFetch');
    expect(isLongRunningRequest('https://x.supabase.co/storage/v1/object/a.jpg')).toBe(true);
    expect(isLongRunningRequest('https://x.supabase.co/functions/v1/fn')).toBe(true);
    expect(isLongRunningRequest('https://x.supabase.co/rest/v1/posts')).toBe(false);
    let seenSignal: AbortSignal | undefined | null;
    const base = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response('ok');
    }) as typeof fetch;
    await createTimeoutFetch(10, base)('https://x.supabase.co/storage/v1/object/a.jpg');
    expect(seenSignal).toBeUndefined();
  });
});
