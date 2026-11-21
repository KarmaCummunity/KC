// Routes the app's data ports through KC's own API when one is configured (ADR-009, ADR-010).
//
// With EXPO_PUBLIC_KC_API_URL unset (the default) `viaApi` returns the adapter it was given:
// the app talks to Supabase exactly as before. With it set, each port method goes to the API
// when the API's manifest lists it, and to the same adapter otherwise or while the API is
// unreachable. What is served is the server's decision, so a port moves behind the API, or
// back, without a new app build.

import {
  createPortRouter,
  createPortTransport,
  type PortCatalog,
  type PortName,
  type PortRouter,
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
async function getAccessToken(forceRefresh: boolean): Promise<string | null> {
  // Loaded on first use: the storage module pulls in native modules, and this file is imported
  // by every composition root, including ones that never touch the session.
  const { pickAuthStorage } = await import('../authSecureStorage');
  const auth = getSupabaseClient({ storage: pickAuthStorage() }).auth;
  const { data } = forceRefresh ? await auth.refreshSession() : await auth.getSession();
  return data.session?.access_token ?? null;
}

let router: PortRouter | null | undefined;

function getRouter(): PortRouter | null {
  if (router !== undefined) return router;
  const baseUrl = getApiBaseUrl();
  router = baseUrl
    ? createPortRouter({ baseUrl, transport: createPortTransport({ baseUrl, getAccessToken }) })
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

/** Test seam: forget the router so the next call reads the environment again. */
export function resetApiBackendForTests(): void {
  router = undefined;
}
