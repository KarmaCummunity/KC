import { PostgrestClient } from '@supabase/postgrest-js';
import { SignJWT } from 'jose';
import type { CompatRequest } from '../../platform/postgrest/requestPlan';
import type { CompatResponse } from '../../platform/postgrest/engine';
import { type SqlBackedClient, UnsupportedSupabaseServiceError } from '../../platform/postgrest/sqlBackedClient';
import type { TestMember } from './kcDatabase';

// Support of the parity suite: the same adapter call is made once on the
// compatibility engine and once on a real PostgREST over the same database,
// and what each was asked and answered is compared, request by request.

/** Where the real PostgREST is and how to act as a member on it. */
export interface PostgrestTarget {
  /** Base address of the REST API, e.g. `http://127.0.0.1:54321/rest/v1`. */
  readonly url: string;
  /** The key the gateway in front of PostgREST asks every request for. */
  readonly anonKey: string;
  /** The secret PostgREST verifies access tokens with. */
  readonly jwtSecret: string;
}

/** A client whose exchanges are recorded, and a way to wait for the ones still on their way. */
export interface RecordedClient {
  readonly client: SqlBackedClient;
  /** Resolves once every request the client sent was answered and recorded. */
  settled(): Promise<void>;
}

/** One request an adapter made, with the answer, in a form two servers can be compared by. */
export interface Exchange {
  readonly request: string;
  readonly status: number;
  /** The `content-range` header: how PostgREST reports the rows of a page and an exact count. */
  readonly range: string | null;
  readonly body: unknown;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?/g;
/** The handle the schema gives a new member, and the name these suites give one. */
const GENERATED_HANDLE = /\bu_[0-9a-f]{12}\b/g;
const TEST_MEMBER_NAME = /\bcontract [0-9a-f]{8}\b/g;

/**
 * Text with what differs between two equivalent runs taken out: the acting
 * member (none for a visitor), any other generated id, and moments in time.
 */
export function withoutRunDetails(text: string, member: TestMember | null): string {
  const withoutMember = member ? text.replaceAll(member.userId, '<member>').replaceAll(member.userId.slice(0, 8), '<member-tag>') : text;
  return withoutMember
    .replace(UUID, '<id>')
    .replace(TIMESTAMP, '<time>')
    .replace(GENERATED_HANDLE, '<handle>')
    .replace(TEST_MEMBER_NAME, '<name>');
}

/** A JSON body with its run details taken out; text that is not JSON is compared as text. */
function comparableBody(text: string | null, member: TestMember | null): unknown {
  if (text === null || text === '') return null;
  const cleaned = withoutRunDetails(text, member);
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return cleaned;
  }
}

/** One exchange in comparable form. The path is taken without its host and API prefix, which differ by server. */
export function exchangeOf(method: string, url: string, requestBody: string | null, status: number, range: string | null, responseBody: string | null, member: TestMember | null): Exchange {
  const { pathname, search } = new URL(url);
  const path = pathname.replace(/^\/rest\/v1/, '') + decodeURIComponent(search);
  const sent = requestBody === null ? '' : ` ${requestBody}`;
  return { request: withoutRunDetails(`${method} ${path}${sent}`, member), status, range, body: comparableBody(responseBody, member) };
}

/** The exchange the engine's observer saw. */
export function engineExchange(request: CompatRequest, response: CompatResponse, member: TestMember | null): Exchange {
  return exchangeOf(request.method, request.url, request.body, response.status, response.headers['content-range'] ?? null, response.body, member);
}

/**
 * The bearer token of a request: for a member, an access token with the
 * claims a signed-in user's carries; for a visitor, the public key itself,
 * which is what the Supabase client sends when nobody is signed in.
 */
async function bearerFor(member: TestMember | null, target: PostgrestTarget): Promise<string> {
  if (!member) return target.anonKey;
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(member.userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(target.jwtSecret));
}

/**
 * A client shaped like the engine's, whose requests go to the real PostgREST
 * as `member`, or as a visitor when there is none. Functions and storage are refused the way the engine's client
 * refuses them without any, so a method that reaches for one fails alike.
 * @param record Receives every exchange, in order.
 */
export async function postgrestClientFor(member: TestMember | null, target: PostgrestTarget, record: (exchange: Exchange) => void): Promise<RecordedClient> {
  const token = await bearerFor(member, target);
  const running = new Set<Promise<unknown>>();
  const exchange = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> => {
    const response = await fetch(input, init);
    const text = await response.text();
    const sent = typeof init?.body === 'string' ? init.body : null;
    record(exchangeOf(init?.method ?? 'GET', String(input), sent, response.status, response.headers.get('content-range'), text, member));
    return new Response(response.status === 204 || response.status === 304 ? null : text, { status: response.status, headers: response.headers });
  };
  const recordingFetch: typeof fetch = (input, init) => {
    const pending = exchange(input, init);
    running.add(pending);
    const forget = () => running.delete(pending);
    pending.then(forget, forget);
    return pending;
  };
  const postgrest = new PostgrestClient(target.url, { headers: { apikey: target.anonKey, authorization: `Bearer ${token}` }, fetch: recordingFetch });
  const user = member ? { id: member.userId } : null;
  const refuse = (service: string): never => {
    throw new UnsupportedSupabaseServiceError(service);
  };
  const client = {
    from: postgrest.from.bind(postgrest),
    rpc: postgrest.rpc.bind(postgrest),
    auth: {
      getSession: () => Promise.resolve({ data: { session: user ? { user } : null }, error: null }),
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    },
    functions: { invoke: (name: string) => refuse(`functions:${name}`) },
    get storage() {
      return refuse('storage');
    },
    channel: () => refuse('realtime'),
  };
  return {
    client: client as unknown as SqlBackedClient,
    settled: async () => {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}

/**
 * Exchanges in an order two runs share: an adapter that asks several things
 * at once sends them in no fixed order.
 */
export function inComparableOrder(exchanges: readonly Exchange[]): Exchange[] {
  return [...exchanges].sort((a, b) => a.request.localeCompare(b.request));
}

/** A value with every leaf replaced by its type: what a body is made of, without what it says. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shapeOf(inner)]));
  return value === null ? 'null' : typeof value;
}

/** The exchanges with each body reduced to its shape, for answers whose values depend on who else is in the database. */
export function withBodyShapesOnly(exchanges: readonly Exchange[]): Exchange[] {
  return exchanges.map((exchange) => ({ ...exchange, body: shapeOf(exchange.body) }));
}
