import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/**
 * Hands a hosted adapter the SQL-backed client under the type its constructor
 * declares. The adapters type their client as the Supabase client; the
 * SQL-backed one serves the slice of it they use (`from`, `rpc`, the session
 * lookups) and names anything else it is asked for (ADR-010).
 */
export function adapterClient<Adapter extends abstract new (client: never, ...rest: never[]) => unknown>(
  client: SqlBackedClient,
): ConstructorParameters<Adapter>[0] {
  return client as unknown as ConstructorParameters<Adapter>[0];
}
