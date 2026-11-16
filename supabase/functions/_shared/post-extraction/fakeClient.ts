// supabase/functions/_shared/post-extraction/fakeClient.ts
// Test double for the Supabase query builder: every method call is recorded and returns the
// same builder, and awaiting it yields the configured result. Used only by tests.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export type Call = [method: string, ...args: unknown[]];

export interface FakeResult { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null }

/** A client whose `from(table)` and `rpc(name)` return builders answering `results[table | name]`. */
export function fakeClient(results: Record<string, FakeResult>, calls: Call[] = []): SupabaseClient {
  const builder = (key: string): unknown => {
    const result = { data: null, count: null, error: null, ...results[key] };
    const target: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(result);
        return (...args: unknown[]) => {
          calls.push([`${key}.${String(prop)}`, ...args]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => {
      calls.push([`rpc.${name}`, args]);
      return builder(name);
    },
  } as unknown as SupabaseClient;
}
