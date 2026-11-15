// ─────────────────────────────────────────────
// Supabase Client Factory
// Mapped to SRS Part V § 5.1–5.2
// ─────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { createTimeoutFetch, DEFAULT_SUPABASE_TIMEOUT_MS } from './timeoutFetch';

// One singleton, typed against the production baseline schema.
let _client: SupabaseClient<Database> | null = null;

// Singleton callback invoked when a PostgREST call returns 403 (RLS forbidden).
// Bound by AuthGate after mount so the router is available. Provides near-instant
// ban detection without waiting for the 60s poll (TD-149).
const _onForbidden: { current: (() => void) | null } = { current: null };

export function setOnForbiddenCallback(fn: (() => void) | null): void {
  _onForbidden.current = fn;
}

function createBannedFetchWithTimeout(
  timeoutMs: number,
  baseFetch?: typeof fetch,
): typeof fetch {
  const timeoutFetch = createTimeoutFetch(timeoutMs, baseFetch);
  return function bannedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return timeoutFetch(input, init).then((res) => {
      if (res.status === 403) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        if (url.includes('/rest/v1/')) _onForbidden.current?.();
      }
      return res;
    });
  };
}

/** AsyncStorage-shaped adapter (RN) or compatible sync storage. */
export type SupabaseAuthStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

export interface SupabaseClientOptions {
  url?: string;
  anonKey?: string;
  storage?: SupabaseAuthStorage;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Returns a singleton Supabase client.
 * Must be called after env vars are available.
 *
 * In React Native / Expo: pass AsyncStorage as the storage adapter.
 * In Node (Edge Functions): no storage adapter needed.
 */
export function getSupabaseClient(options?: SupabaseClientOptions): SupabaseClient<Database> {
  return getTypedClient(options);
}


function getTypedClient(options?: SupabaseClientOptions): SupabaseClient<Database> {
  if (_client) return _client;

  // Audit 2026-05-10 §4.2: only EXPO_PUBLIC_* is inlined by Metro into the
  // mobile bundle. A non-prefixed fallback (`SUPABASE_URL`) never fires
  // on-device — but in a Node test/CI context it can resolve to a different
  // secret than EXPO_PUBLIC_SUPABASE_URL, causing silent test↔prod divergence.
  // Edge Functions create their own client via Deno.env directly and don't
  // consume this factory, so dropping the fallback is safe.
  const url = options?.url ?? (typeof process !== 'undefined'
    ? (process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? '')
    : '');

  const anonKey = options?.anonKey ?? (typeof process !== 'undefined'
    ? (process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '')
    : '');

  if (!url || !anonKey) {
    throw new Error(
      'Supabase configuration missing: both EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY must be set (or passed via options).',
    );
  }

  // Web and native both exchange the OAuth `code` explicitly via the auth/callback route,
  // so disable auto-detect to avoid racing the explicit exchange.
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SUPABASE_TIMEOUT_MS;
  const globalFetch = createBannedFetchWithTimeout(timeoutMs, options?.fetch);

  _client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      ...(options?.storage ? { storage: options.storage } : {}),
    },
    global: { fetch: globalFetch },
  });

  return _client;
}

/** Reset the singleton (useful in tests). */
export function resetSupabaseClient(): void {
  _client = null;
}
