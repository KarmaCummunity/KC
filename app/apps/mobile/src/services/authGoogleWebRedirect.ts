// FR-AUTH-003 / FR-AUTH-007 (web): same-tab Google OAuth redirect (Safari blocks popups).
import { Platform } from 'react-native';
import type { IAuthService } from '@kc/application';

/**
 * Same-tab redirect to Google. Web only — Safari blocks the `window.open`
 * popup that `WebBrowser.openAuthSessionAsync` performs on web (the popup is
 * blocked because GIS / our auth call happens after an async fetch, outside
 * the user-gesture window). Same-tab navigation is the standard pattern used
 * by Notion, Linear, GitHub: page navigates to `accounts.google.com`, user
 * picks an account, browser returns to `/auth/callback` with `?code=...` for
 * the existing exchange flow. The JS context here is destroyed by the
 * navigation, so this function never "resolves" in a meaningful sense — it
 * only rejects if `getGoogleAuthUrl` fails *before* the redirect fires.
 */
export async function redirectToGoogleSignInWeb(auth: IAuthService): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    throw new Error('redirectToGoogleSignInWeb: web-only');
  }
  const redirectTo = `${window.location.origin}/auth/callback`;
  const url = await auth.getGoogleAuthUrl(redirectTo);
  window.location.assign(url);
}
