// Browser OAuth session helpers for FR-AUTH-003 / FR-AUTH-007 (native Google browser flow).
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import type { OpenAuthSession } from '@kc/application';

export const openAuthSession: OpenAuthSession = async (url, redirectTo) => {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (result.type === 'success') return result.url;
  return null;
};

/** Deep link the OAuth provider redirects back to. Resolves per-platform via AuthSession. */
export function getOAuthRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'karmacommunity',
    path: 'auth/callback',
  });
}
