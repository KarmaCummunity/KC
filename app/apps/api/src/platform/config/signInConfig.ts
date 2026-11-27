// What KC's own identity needs to accept a sign-in through Google or Apple (ADR-013 section 3):
// the client ids KC is registered under at each. An ID token is accepted only when it was issued
// for one of them. None is a secret.

import { ApiConfigError, type Env, readVariable } from './configReader';

/** The client KC is at Google for a sign-in that goes through the browser: its id, and the secret Google gave it. */
export interface GoogleBrowserClient {
  readonly clientId: string;
  /** A secret. */
  readonly clientSecret: string;
}

export interface SignInConfig {
  /** Google OAuth client ids of KC's apps (web, iOS, Android). Empty: nobody signs in with Google. */
  readonly googleClientIds: readonly string[];
  /** Apple identifiers of KC's apps (the iOS bundle id, a web services id). Empty: nobody signs in with Apple. */
  readonly appleClientIds: readonly string[];
  /** Null: nobody signs in with Google through a browser redirect; the native sheet still works. */
  readonly googleBrowserClient: GoogleBrowserClient | null;
}

/** A comma-separated list; blanks are dropped. */
function listOf(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** The browser client needs both its id and its secret. */
function parseGoogleBrowserClient(env: Env): GoogleBrowserClient | null {
  const clientId = readVariable(env, 'KC_AUTH_GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = readVariable(env, 'KC_AUTH_GOOGLE_OAUTH_CLIENT_SECRET');
  if (clientId === undefined && clientSecret === undefined) return null;
  if (clientId === undefined) throw new ApiConfigError('KC_AUTH_GOOGLE_OAUTH_CLIENT_ID', 'is required when KC_AUTH_GOOGLE_OAUTH_CLIENT_SECRET is set');
  if (clientSecret === undefined) throw new ApiConfigError('KC_AUTH_GOOGLE_OAUTH_CLIENT_SECRET', 'is required when KC_AUTH_GOOGLE_OAUTH_CLIENT_ID is set');
  return { clientId, clientSecret };
}

/** @throws ApiConfigError on a browser client that is half configured. */
export function loadSignInConfig(env: Env): SignInConfig {
  const googleBrowserClient = parseGoogleBrowserClient(env);
  const googleClientIds = listOf(readVariable(env, 'KC_AUTH_GOOGLE_CLIENT_IDS'));
  return {
    // A token the browser flow ends with is issued for the browser client, so that client is always one of the accepted ones.
    googleClientIds: googleBrowserClient && !googleClientIds.includes(googleBrowserClient.clientId) ? [...googleClientIds, googleBrowserClient.clientId] : googleClientIds,
    appleClientIds: listOf(readVariable(env, 'KC_AUTH_APPLE_CLIENT_IDS')),
    googleBrowserClient,
  };
}
