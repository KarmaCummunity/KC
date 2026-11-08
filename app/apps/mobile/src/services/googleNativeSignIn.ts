// FR-AUTH-003 / FR-AUTH-007 (#1955): native Google account sheet → ID token for Supabase.
// Any SDK failure other than a cancel resolves `unavailable`, so the caller falls back to the browser flow.
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import type { GoogleIdTokenResult, RequestGoogleIdToken } from '@kc/application';
import type { GoogleNativeSignInConfig } from '../lib/auth/googleNativeSignInConfig';
import { getSentryIfInit } from '../lib/observability/sentry';

const UNAVAILABLE: GoogleIdTokenResult = { kind: 'unavailable' };
const CANCELLED: GoogleIdTokenResult = { kind: 'cancelled' };

function isUserCancel(err: unknown): boolean {
  return isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS);
}

function reportUnavailable(err: unknown): void {
  const code = isErrorWithCode(err) ? String(err.code) : 'none';
  getSentryIfInit()?.captureException(err, { tags: { area: 'auth', action: 'google_native_sign_in', sdk_code: code } });
}

export function createGoogleIdTokenRequester(config: GoogleNativeSignInConfig): RequestGoogleIdToken {
  let configured = false;
  return async () => {
    try {
      if (!configured) {
        GoogleSignin.configure({ webClientId: config.webClientId, iosClientId: config.iosClientId });
        configured = true;
      }
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Clears the remembered account so the picker always shows (parity with prompt=select_account).
      await GoogleSignin.signOut().catch(() => undefined);
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return CANCELLED;
      const idToken = response.data.idToken;
      if (idToken) return { kind: 'token', idToken };
      reportUnavailable(new Error('google_native_no_id_token'));
      return UNAVAILABLE;
    } catch (err) {
      if (isUserCancel(err)) return CANCELLED;
      reportUnavailable(err);
      return UNAVAILABLE;
    }
  };
}
