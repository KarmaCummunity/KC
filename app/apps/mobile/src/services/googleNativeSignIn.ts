// ─────────────────────────────────────────────
// Native Google account picker (iOS/Android) for FR-AUTH-003 / FR-AUTH-007.
// Returns the Google ID token for `signInWithIdToken`; Google never receives the
// Supabase host as a redirect target, so its UI shows the verified app name
// ({{ENG:native-google-sign-in}}). Resolves `unavailable` whenever the picker
// cannot run, so the use case falls back to the browser OAuth flow.
// ─────────────────────────────────────────────

import { Platform } from 'react-native';
import type { NativeGoogleSignInResult, PerformNativeGoogleSignIn } from '@kc/application';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

const UNAVAILABLE: NativeGoogleSignInResult = { kind: 'unavailable' };

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

let configuredModule: GoogleSignInModule | null = null;

function isConfiguredForPlatform(): boolean {
  if (!webClientId) return false;
  if (Platform.OS === 'ios') return Boolean(iosClientId);
  return Platform.OS === 'android';
}

/** The native module is absent in Expo Go and in binaries built before it was added. */
function loadModule(): GoogleSignInModule | null {
  if (configuredModule) return configuredModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
    mod.GoogleSignin.configure({ webClientId, iosClientId });
    configuredModule = mod;
    return mod;
  } catch {
    return null;
  }
}

function isCancellation(mod: GoogleSignInModule, err: unknown): boolean {
  return mod.isErrorWithCode(err) && err.code === mod.statusCodes.SIGN_IN_CANCELLED;
}

export const performNativeGoogleSignIn: PerformNativeGoogleSignIn = async () => {
  if (!isConfiguredForPlatform()) return UNAVAILABLE;
  const mod = loadModule();
  if (!mod) return UNAVAILABLE;
  const { GoogleSignin } = mod;
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    // Clears the SDK's cached Google account so the picker always shows (parity with `prompt=select_account`).
    await GoogleSignin.signOut();
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return { kind: 'cancelled' };
    const idToken = response.data.idToken;
    return idToken ? { kind: 'token', idToken } : UNAVAILABLE;
  } catch (err) {
    if (isCancellation(mod, err)) return { kind: 'cancelled' };
    // Misconfiguration (e.g. Android DEVELOPER_ERROR for an unregistered SHA-1) must not block sign-in.
    const code = mod.isErrorWithCode(err) ? err.code : 'unknown';
    console.warn(`[auth] native Google sign-in unavailable (${code}); using browser flow`);
    return UNAVAILABLE;
  }
};
