import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CreateClientCall {
  url: string;
  anonKey: string;
  options: any;
}

const createClientCalls: CreateClientCall[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, anonKey: string, options: any) => {
    createClientCalls.push({ url, anonKey, options });
    return { _isFakeClient: true, _url: url, _anonKey: anonKey, _options: options };
  },
}));

import {
  getSupabaseClient,
  resetSupabaseClient,
  setOnForbiddenCallback,
} from '../client';

const ORIGINAL_URL = process.env['EXPO_PUBLIC_SUPABASE_URL'];
const ORIGINAL_KEY = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];

beforeEach(() => {
  createClientCalls.length = 0;
  resetSupabaseClient();
  setOnForbiddenCallback(null);
});

afterEach(() => {
  // Restore env so we don't leak state into other tests in the same run.
  if (ORIGINAL_URL === undefined) delete process.env['EXPO_PUBLIC_SUPABASE_URL'];
  else process.env['EXPO_PUBLIC_SUPABASE_URL'] = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  else process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = ORIGINAL_KEY;
});

describe('getSupabaseClient — options and env resolution', () => {
  it('uses options.url + options.anonKey when both are provided (takes precedence over env)', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    getSupabaseClient({ url: 'http://opt-url', anonKey: 'opt-key' });
    expect(createClientCalls).toHaveLength(1);
    expect(createClientCalls[0]?.url).toBe('http://opt-url');
    expect(createClientCalls[0]?.anonKey).toBe('opt-key');
  });

  it('falls back to EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY when options are absent', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    getSupabaseClient();
    expect(createClientCalls[0]?.url).toBe('http://env-url');
    expect(createClientCalls[0]?.anonKey).toBe('env-key');
  });

  it('throws a descriptive error when url is missing (per audit 2026-05-10 §4.2 — no non-prefixed fallback)', () => {
    delete process.env['EXPO_PUBLIC_SUPABASE_URL'];
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    expect(() => getSupabaseClient()).toThrow(/Supabase configuration missing/);
  });

  it('throws a descriptive error when anonKey is missing', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    delete process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
    expect(() => getSupabaseClient()).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe('getSupabaseClient — auth config', () => {
  it('configures PKCE with autoRefresh + persistSession but disables detectSessionInUrl', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    getSupabaseClient();
    const auth = createClientCalls[0]?.options.auth;
    expect(auth.flowType).toBe('pkce');
    expect(auth.autoRefreshToken).toBe(true);
    expect(auth.persistSession).toBe(true);
    expect(auth.detectSessionInUrl).toBe(false);
  });

  it('passes through a storage adapter when supplied (RN AsyncStorage path)', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    const fakeStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    getSupabaseClient({ storage: fakeStorage });
    expect(createClientCalls[0]?.options.auth.storage).toBe(fakeStorage);
  });

  it('omits the auth.storage key when no adapter is supplied (Node/Edge path)', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    getSupabaseClient();
    expect(Object.prototype.hasOwnProperty.call(createClientCalls[0]?.options.auth, 'storage')).toBe(false);
  });
});

describe('getSupabaseClient — singleton + reset', () => {
  it('returns the same instance on repeated calls without reset (singleton)', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    const a = getSupabaseClient();
    const b = getSupabaseClient({ url: 'http://different', anonKey: 'different' });
    expect(a).toBe(b);
    expect(createClientCalls).toHaveLength(1);
  });

  it('resetSupabaseClient() clears the singleton so the next call builds a fresh one', () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    getSupabaseClient();
    resetSupabaseClient();
    getSupabaseClient();
    expect(createClientCalls).toHaveLength(2);
  });
});

describe('bannedFetch — forbidden callback wiring (TD-149)', () => {
  it('global.fetch wraps real fetch and fires the on-forbidden callback when a /rest/v1 call returns 403', async () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';

    const realFetch = globalThis.fetch;
    const responses: Array<{ url: string; status: number }> = [
      { url: 'http://env-url/rest/v1/users', status: 403 },
      { url: 'http://env-url/rest/v1/posts', status: 200 },
      { url: 'http://env-url/auth/v1/token', status: 403 },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const r = responses[i++]!;
      return new Response(null, { status: r.status });
    }) as any;
    try {
      getSupabaseClient();
      const wrappedFetch = createClientCalls[0]?.options.global.fetch as typeof fetch;
      let calls = 0;
      setOnForbiddenCallback(() => { calls += 1; });

      const r1 = await wrappedFetch('http://env-url/rest/v1/users');
      expect(r1.status).toBe(403);
      expect(calls).toBe(1); // 403 on /rest/v1 fires the callback

      const r2 = await wrappedFetch('http://env-url/rest/v1/posts');
      expect(r2.status).toBe(200);
      expect(calls).toBe(1); // 200 does not fire

      const r3 = await wrappedFetch('http://env-url/auth/v1/token');
      expect(r3.status).toBe(403);
      expect(calls).toBe(1); // 403 outside /rest/v1 does not fire
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('does not fire the callback when none is registered (defensive: no-op when null)', async () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as any;
    try {
      getSupabaseClient();
      const wrappedFetch = createClientCalls[0]?.options.global.fetch as typeof fetch;
      // callback explicitly unset in beforeEach — nothing to do but assert it doesn't throw
      const res = await wrappedFetch('http://env-url/rest/v1/users');
      expect(res.status).toBe(403);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('setOnForbiddenCallback(null) unregisters a previously-set callback', async () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as any;
    try {
      getSupabaseClient();
      const wrappedFetch = createClientCalls[0]?.options.global.fetch as typeof fetch;
      let calls = 0;
      setOnForbiddenCallback(() => { calls += 1; });
      await wrappedFetch('http://env-url/rest/v1/users');
      expect(calls).toBe(1);
      setOnForbiddenCallback(null);
      await wrappedFetch('http://env-url/rest/v1/users');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('aborts when the request hangs beyond options.timeoutMs', async () => {
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'http://env-url';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'env-key';
    const hangingFetch = vi.fn().mockImplementation((_input, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('Aborted'));
        });
      });
    });

    getSupabaseClient({ timeoutMs: 50, fetch: hangingFetch as unknown as typeof fetch });
    const wrappedFetch = createClientCalls[0]?.options.global.fetch as typeof fetch;

    await expect(wrappedFetch('http://env-url/rest/v1/slow')).rejects.toThrow(/timed out after 50ms/);
  });
});
