import { PostgrestClient } from '@supabase/postgrest-js';
import type { CallerIdentity } from '../identity/callerIdentity';
import type { CompatRequest } from './requestPlan';
import { handleCompatRequest, type SchemaCacheSource, type StatementRunner } from './engine';

/** A Supabase service the gateway does not carry yet was called. */
export class UnsupportedSupabaseServiceError extends Error {
  constructor(service: string) {
    super(`the "${service}" service is not available through the API yet`);
    this.name = 'UnsupportedSupabaseServiceError';
  }
}

/**
 * The slice of the Supabase client the data adapters use: the PostgREST
 * builder and the session lookup. Adapters receive it typed as their own
 * `SupabaseClient`, so they need no change to run on the server.
 */
export interface SqlBackedClient {
  readonly from: PostgrestClient['from'];
  readonly rpc: PostgrestClient['rpc'];
  readonly auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: null }>;
    getUser(): Promise<{ data: { user: { id: string } | null }; error: null }>;
  };
}

// Never requested: the engine answers in process. It only gives the builder a base to form URLs on.
const BASE_URL = 'http://kc-api.internal/rest/v1';

function lowerCaseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

/** Names the services the gateway cannot serve, failing loudly instead of with `undefined is not a function`. */
function unsupportedService(service: string): never {
  throw new UnsupportedSupabaseServiceError(service);
}

/**
 * Builds a Supabase-shaped client whose requests are answered by the
 * compatibility engine instead of the network.
 * @param run Executes one statement as `caller` (a transaction of its own,
 *   like one PostgREST request).
 */
export function createSqlBackedClient(caller: CallerIdentity | null, schema: SchemaCacheSource, run: StatementRunner): SqlBackedClient {
  const fetchInProcess: typeof fetch = async (input, init) => {
    const request: CompatRequest = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: lowerCaseHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    const response = await handleCompatRequest(request, schema, run);
    return new Response(response.body, { status: response.status, headers: response.headers });
  };

  const postgrest = new PostgrestClient(BASE_URL, { fetch: fetchInProcess });
  const user = caller ? { id: caller.userId } : null;
  const client = {
    from: postgrest.from.bind(postgrest),
    rpc: postgrest.rpc.bind(postgrest),
    auth: {
      getSession: () => Promise.resolve({ data: { session: user ? { user } : null }, error: null }),
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    },
    // Edge Functions, Storage and Realtime move in their own phases (ADR-009 phases 6–8).
    get functions() {
      return unsupportedService('functions');
    },
    get storage() {
      return unsupportedService('storage');
    },
    channel: () => unsupportedService('realtime'),
  };
  return client as SqlBackedClient;
}
