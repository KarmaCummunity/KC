import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

/** The `{ data, error }` envelope a supabase-js call resolves with. */
export interface FakeResult {
  readonly data: unknown;
  readonly error: { code?: string; message: string } | null;
}

/** One builder call recorded on a `from(table)` chain, for example `['eq', ['status', 'open']]`. */
export type RecordedCall = readonly [method: string, args: readonly unknown[]];

export interface FakeStaffClient {
  readonly client: SupabaseClient<Database>;
  /** Every `from(table)` chain, in call order. */
  readonly chains: Array<{ table: string; calls: RecordedCall[] }>;
  /** Every `rpc(name, args)` call, in call order. */
  readonly rpcCalls: Array<{ name: string; args: unknown }>;
}

export interface FakeStaffClientOptions {
  /** Result of each table's chain; an array is consumed one entry per `from(table)` call. */
  readonly tables?: Readonly<Record<string, FakeResult | readonly FakeResult[]>>;
  /** Result of each RPC. */
  readonly rpc?: Readonly<Record<string, FakeResult>>;
}

const OK_EMPTY: FakeResult = { data: [], error: null };

/**
 * A fake supabase-js client for the staff adapters. `from(table)` returns a chainable builder
 * that records every method call and resolves to the configured result when awaited, whatever
 * the chain (`select`, `eq`, `order`, `limit`, `in`, ...); `rpc(name, args)` resolves to the
 * configured RPC result. Records calls so a test can assert the table, the filters and the
 * RPC argument names.
 */
export function fakeStaffClient(options: FakeStaffClientOptions = {}): FakeStaffClient {
  const chains: FakeStaffClient['chains'] = [];
  const rpcCalls: FakeStaffClient['rpcCalls'] = [];
  const taken = new Map<string, number>();

  const resultOf = (table: string): FakeResult => {
    const configured = options.tables?.[table];
    if (configured === undefined) return OK_EMPTY;
    if (!Array.isArray(configured)) return configured as FakeResult;
    const index = taken.get(table) ?? 0;
    taken.set(table, index + 1);
    return (configured as readonly FakeResult[])[Math.min(index, configured.length - 1)]!;
  };

  const client = {
    from(table: string) {
      const calls: RecordedCall[] = [];
      chains.push({ table, calls });
      const result = resultOf(table);
      const builder: unknown = new Proxy({}, {
        get(_target, property: string) {
          if (property === 'then') {
            return (resolve: (value: FakeResult) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            calls.push([property, args]);
            return builder;
          };
        },
      });
      return builder;
    },
    rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve(options.rpc?.[name] ?? OK_EMPTY);
    },
  } as unknown as SupabaseClient<Database>;

  return { client, chains, rpcCalls };
}

/** True when the chain recorded `method` with exactly `args`. */
export function chainHas(chain: { calls: readonly RecordedCall[] }, method: string, ...args: unknown[]): boolean {
  return chain.calls.some(([m, a]) => m === method && JSON.stringify(a) === JSON.stringify(args));
}
