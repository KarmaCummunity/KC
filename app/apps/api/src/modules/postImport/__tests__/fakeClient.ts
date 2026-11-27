import type { SqlBackedClient } from '../../../platform/postgrest/sqlBackedClient';

/** One recorded builder call: `<table or function>.<method>` and its arguments. */
export type Call = [method: string, ...args: unknown[]];

export interface FakeResult {
  data?: unknown;
  count?: number | null;
  error?: { message: string; code?: string } | null;
}

/**
 * A stand-in for the query builder: every method call is recorded and returns
 * the same builder, and awaiting it yields the configured result. `from(table)`
 * and `rpc(name)` answer `results[table | name]`.
 */
export function fakeClient(results: Record<string, FakeResult>, calls: Call[] = []): SqlBackedClient {
  const builder = (key: string): unknown => {
    const result = { data: null, count: null, error: null, ...results[key] };
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, property) => {
          // Awaiting the builder resolves it, as the real one does.
          if (property === 'then') return (resolve: (value: unknown) => unknown) => resolve(result);
          return (...args: unknown[]) => {
            calls.push([`${key}.${String(property)}`, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => {
      calls.push([`rpc.${name}`, args]);
      return builder(name);
    },
  } as unknown as SqlBackedClient;
}
