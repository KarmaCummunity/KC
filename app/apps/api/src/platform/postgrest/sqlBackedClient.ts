import { PostgrestClient } from '@supabase/postgrest-js';
import type { CallerIdentity } from '../identity/callerIdentity';
import type { CompatRequest } from './requestPlan';
import { type CompatResponse, handleCompatRequest, type SchemaCacheSource, type StatementRunner } from './engine';

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
  readonly functions: {
    invoke(name: string, options?: { body?: unknown }): Promise<{ data: unknown; error: unknown }>;
  };
  readonly auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: null }>;
    getUser(): Promise<{ data: { user: { id: string } | null }; error: null }>;
  };
}

/**
 * What stands in for an Edge Function: server code that takes the request
 * body and answers with a status and a JSON body, as the function would.
 */
export type InProcessFunction = (body: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;

/** The functions a client may invoke, by the Edge Function name the adapters use. */
export type InProcessFunctions = Readonly<Record<string, InProcessFunction>>;

// Never requested: the engine answers in process. It only gives the builder a base to form URLs on.
const BASE_URL = 'http://kc-api.internal/rest/v1';

function lowerCaseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

/** One bucket, with the storage methods the hosted adapters use, answering in the client library's shapes. */
export interface InProcessBucket {
  getPublicUrl(path: string): { data: { publicUrl: string } };
  upload(
    path: string,
    body: ArrayBuffer | Uint8Array,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
}

/** The `storage` member of the client, answered by this server's own file store. */
export interface InProcessStorage {
  from(bucket: string): InProcessBucket;
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
 * @param observe Sees every request with its answer, for logging; it must not throw.
 * @param functions The Edge Functions this server has taken over, by name.
 * @param storage The server's own file store acting as `caller`; without one, reaching for `storage` fails loudly.
 */
export function createSqlBackedClient(
  caller: CallerIdentity | null,
  schema: SchemaCacheSource,
  run: StatementRunner,
  observe?: (request: CompatRequest, response: CompatResponse) => void,
  functions: InProcessFunctions = {},
  storage: InProcessStorage | null = null,
): SqlBackedClient {
  const fetchInProcess: typeof fetch = async (input, init) => {
    const request: CompatRequest = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: lowerCaseHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    const response = await handleCompatRequest(request, schema, run);
    observe?.(request, response);
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
    functions: {
      /**
       * Answers like the Supabase functions client: `data` for a 2xx answer,
       * otherwise an error that carries the response, which is how the
       * adapters read a function's refusal.
       */
      async invoke(name: string, options: { body?: unknown } = {}) {
        // A function this server has not taken over yet (ADR-009 phase 8).
        if (!Object.hasOwn(functions, name)) return unsupportedService(`functions:${name}`);
        const answer = await (functions[name] as InProcessFunction)(options.body);
        if (answer.status >= 200 && answer.status < 300) return { data: answer.body, error: null };
        const context = new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
        return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context } };
      },
    },
    // Files are answered by the server's own store when it has one (ADR-012); channels are not a server-side concern.
    get storage() {
      return storage ?? unsupportedService('storage');
    },
    channel: () => unsupportedService('realtime'),
  };
  return client as SqlBackedClient;
}
