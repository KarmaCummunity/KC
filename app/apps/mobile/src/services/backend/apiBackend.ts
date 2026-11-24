// Routes the app's data ports through KC's own API when one is configured (ADR-009, ADR-010).
//
// With EXPO_PUBLIC_KC_API_URL unset (the default) `viaApi` returns the adapter it was given:
// the app talks to Supabase exactly as before. With it set, each port method goes to the API
// when the API's manifest lists it, and to the same adapter otherwise or while the API is
// unreachable or slow to answer (the router waits a bounded time for the manifest, so a
// silent API never holds up the app's start). What is served, and to which share of the
// members and from which app version, is the server's decision, so a port moves behind the
// API, or back, without a new app build.

import {
  type ApiRealtimeHost,
  createApiRealtimeHost,
  createPortRouter,
  createPortTransport,
  type PortCatalog,
  type PortName,
  type PortRouter,
  REALTIME_PATH,
  RealtimeSocket,
} from '@kc/infrastructure-api';
import { getSupabaseClient } from '@kc/infrastructure-supabase';

/** Base URL of KC's API without a trailing slash, or null when the app is not pointed at one. */
export function getApiBaseUrl(): string | null {
  const raw = typeof process !== 'undefined' ? process.env['EXPO_PUBLIC_KC_API_URL'] : undefined;
  const url = raw?.trim().replace(/\/+$/, '');
  return url ? url : null;
}

/**
 * The signed-in member's access token for an API call, or null when signed out.
 * Until KC issues its own tokens (ADR-009 phase 9) this is the Supabase session's token,
 * which the API verifies against the same issuer.
 */
export async function getAccessToken(forceRefresh: boolean): Promise<string | null> {
  // Loaded on first use: the storage module pulls in native modules, and this file is imported
  // by every composition root, including ones that never touch the session.
  const { pickAuthStorage } = await import('../authSecureStorage');
  const auth = getSupabaseClient({ storage: pickAuthStorage() }).auth;
  const { data } = forceRefresh ? await auth.refreshSession() : await auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * The signed-in member's id, or null when signed out. The router asks only for a port the
 * server serves to a share of the members: the share a member falls in is a hash of this id.
 */
async function getMemberId(): Promise<string | null> {
  const { pickAuthStorage } = await import('../authSecureStorage');
  const { data } = await getSupabaseClient({ storage: pickAuthStorage() }).auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * This build's version (from `app/VERSION` at build time), or null when the build does not
 * expose its config. Loaded on first use, like the session storage above.
 */
async function getAppVersion(): Promise<string | null> {
  const { default: Constants } = await import('expo-constants');
  return Constants.expoConfig?.version?.trim() || null;
}

let router: PortRouter | null | undefined;

function getRouter(): PortRouter | null {
  if (router !== undefined) return router;
  const baseUrl = getApiBaseUrl();
  router = baseUrl
    ? createPortRouter({ baseUrl, transport: createPortTransport({ baseUrl, getAccessToken }), getMemberId, getAppVersion })
    : null;
  return router;
}

/**
 * Wraps a data adapter so its port can be served by the API.
 * @param name The port's wire name in the shared catalog; the compiler checks that the
 *   adapter implements the interface the catalog gives that name.
 * @param adapter The adapter in place today (the fallback for everything the API does not serve).
 */
export function viaApi<Name extends PortName, Adapter extends PortCatalog[Name]>(name: Name, adapter: Adapter): Adapter {
  return getRouter()?.port(name, adapter) ?? adapter;
}

let realtimeHost: ApiRealtimeHost | null | undefined;

/**
 * The API's realtime host, or null when realtime stays on Supabase. Realtime has its own
 * switch (`EXPO_PUBLIC_KC_API_REALTIME=1`, with the API address set): the API can only carry
 * the database's events once KC runs its own PostgreSQL (ADR-011), which is later than the
 * data ports move.
 */
function getRealtimeHost(): ApiRealtimeHost | null {
  if (realtimeHost !== undefined) return realtimeHost;
  const baseUrl = getApiBaseUrl();
  const enabled = typeof process !== 'undefined' && process.env['EXPO_PUBLIC_KC_API_REALTIME'] === '1';
  realtimeHost =
    baseUrl && enabled
      ? // `http(s)://` becomes `ws(s)://`: the endpoint is the API's own address.
        createApiRealtimeHost(new RealtimeSocket({ url: `${baseUrl.replace(/^http/, 'ws')}${REALTIME_PATH}`, getAccessToken }))
      : null;
  return realtimeHost;
}

/**
 * Gives a realtime adapter the client its channels go through: the Supabase client as it is,
 * or the same client with its four realtime members (`channel`, `removeChannel`,
 * `getChannels`, `realtime`) replaced by the API's host. The adapter does not change.
 */
export function viaApiRealtime<Client extends object>(client: Client): Client {
  const host = getRealtimeHost();
  if (!host) return client;
  // The host's members shadow the client's; everything else is still read from the client.
  return Object.assign(Object.create(client) as Client, {
    channel: host.channel.bind(host),
    removeChannel: host.removeChannel.bind(host),
    getChannels: host.getChannels.bind(host),
    realtime: host.realtime,
  });
}

/** Test seam: forget the router and the realtime host so the next call reads the environment again. */
export function resetApiBackendForTests(): void {
  router = undefined;
  realtimeHost = undefined;
}
