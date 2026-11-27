// What KC's own identity needs to accept a sign-in through Google or Apple (ADR-013 section 3):
// the client ids KC is registered under at each. An ID token is accepted only when it was issued
// for one of them. None is a secret.

import { type Env, readVariable } from './configReader';

export interface SignInConfig {
  /** Google OAuth client ids of KC's apps (web, iOS, Android). Empty: nobody signs in with Google. */
  readonly googleClientIds: readonly string[];
  /** Apple identifiers of KC's apps (the iOS bundle id, a web services id). Empty: nobody signs in with Apple. */
  readonly appleClientIds: readonly string[];
}

/** A comma-separated list; blanks are dropped. */
function listOf(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

export function loadSignInConfig(env: Env): SignInConfig {
  return {
    googleClientIds: listOf(readVariable(env, 'KC_AUTH_GOOGLE_CLIENT_IDS')),
    appleClientIds: listOf(readVariable(env, 'KC_AUTH_APPLE_CLIENT_IDS')),
  };
}
