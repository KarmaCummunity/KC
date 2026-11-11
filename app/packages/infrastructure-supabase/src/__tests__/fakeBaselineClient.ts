// A recording fake of the supabase-js client for the adapter unit tests: chainable query builders
// that resolve to configured `{ data, error }` results, `rpc` and a cached session. It checks
// nothing itself — a test reads `calls` and asserts the RPC name, the argument names, the
// filters and the payload, which is the contract of an adapter against the baseline.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export type FakeError = { code?: string; message: string; details?: string } | null;
export type FakeResult = { data: unknown; error: FakeError };

export interface FakeCall {
  /** `rpc` for a function call; otherwise the first operation of the builder chain. */
  kind: 'rpc' | 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  table?: string;
  fn?: string;
  /** RPC arguments. */
  args?: unknown;
  /** Columns of the last `.select(...)`. */
  columns?: string;
  /** Payload of insert / update / upsert. */
  payload?: unknown;
  /** Every filter and modifier in call order, e.g. `['eq', 'id', 'u1']`. */
  filters: unknown[][];
  /** True when the chain ended in `.single()` or `.maybeSingle()`. */
  single: boolean;
}

type Handler = FakeResult | ((call: FakeCall) => FakeResult);

export interface FakeClientConfig {
  /** Result per table; a function sees the call (and may answer per operation). */
  tables?: Record<string, Handler>;
  /** Result per RPC name. */
  rpc?: Record<string, Handler>;
  /** Id of the cached session's user; null = signed out. */
  userId?: string | null;
}

const OK: FakeResult = { data: null, error: null };
const MODIFIERS = ['eq', 'neq', 'in', 'or', 'lt', 'gt', 'gte', 'lte', 'is', 'order', 'limit', 'range'] as const;

function answer(handler: Handler | undefined, call: FakeCall): FakeResult {
  if (handler === undefined) return OK;
  return typeof handler === 'function' ? handler(call) : handler;
}

/** Builds the fake client and the list its calls are recorded in. */
export function createFakeClient(config: FakeClientConfig = {}): {
  client: SupabaseClient<Database>;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];

  const from = (table: string) => {
    const call: FakeCall = { kind: 'select', table, filters: [], single: false };
    let started = false;
    calls.push(call);
    const settle = () => Promise.resolve(answer(config.tables?.[table], call));
    const chain: Record<string, unknown> = {};
    const start = (kind: FakeCall['kind'], payload?: unknown) => {
      call.kind = kind;
      call.payload = payload;
      started = true;
      return chain;
    };
    for (const name of MODIFIERS) {
      chain[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return chain;
      };
    }
    chain['select'] = (columns?: string) => {
      call.columns = columns;
      if (!started) started = true;
      return chain;
    };
    chain['insert'] = (payload: unknown) => start('insert', payload);
    chain['update'] = (payload: unknown) => start('update', payload);
    chain['upsert'] = (payload: unknown, options?: unknown) => {
      call.filters.push(['onConflict', options]);
      return start('upsert', payload);
    };
    chain['delete'] = () => start('delete');
    chain['maybeSingle'] = () => {
      call.single = true;
      return settle();
    };
    chain['single'] = chain['maybeSingle'];
    chain['then'] = (resolve: (r: FakeResult) => unknown, reject: (e: unknown) => unknown) =>
      settle().then(resolve, reject);
    return chain;
  };

  const rpc = async (fn: string, args?: unknown) => {
    const call: FakeCall = { kind: 'rpc', fn, args, filters: [], single: false };
    calls.push(call);
    return answer(config.rpc?.[fn], call);
  };

  const getSession = async () => ({
    data: { session: config.userId ? { user: { id: config.userId } } : null },
  });

  const client = { from, rpc, auth: { getSession } } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

/** The recorded calls to one table (or function). */
export function callsTo(calls: readonly FakeCall[], target: string): FakeCall[] {
  return calls.filter((call) => call.table === target || call.fn === target);
}
