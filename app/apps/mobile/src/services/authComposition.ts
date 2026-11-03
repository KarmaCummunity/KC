// ─────────────────────────────────────────────
// Composition root — wires Supabase adapter into application use cases.
// Lives in the mobile app (composition root); not in /domain or /application.
// Mapped to SRS: FR-AUTH-003 (Google sign-up), FR-AUTH-006 (email sign-up),
// FR-AUTH-007 (sign-in, all paths), FR-AUTH-013 (cold-start restore), FR-AUTH-017 (sign-out).
// docs/SSOT/spec/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import { Platform } from 'react-native';
import { pickAuthStorage } from './authSecureStorage';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  getSupabaseClient,
  SupabaseAccountGateRepository,
  SupabaseAuthService,
} from '@kc/infrastructure-supabase';
import {
  RestoreSessionUseCase,
  SignInWithEmailUseCase,
  SignInWithGoogleUseCase,
  SignInWithAppleUseCase,
  SignOutUseCase,
  SignUpWithEmailUseCase,
  ResendVerificationEmailUseCase,
  VerifyEmailUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  type AuthSession as KcAuthSession,
  type IAuthService,
  type OpenAuthSession,
  type PerformAppleSignIn,
} from '@kc/application';
import { webBaseUrl } from '../config/featureFlags';

let _authService: IAuthService | null = null;
let _signUp: SignUpWithEmailUseCase | null = null;
let _signIn: SignInWithEmailUseCase | null = null;
let _signInGoogle: SignInWithGoogleUseCase | null = null;
let _signInApple: SignInWithAppleUseCase | null = null;
let _signOut: SignOutUseCase | null = null;
let _restore: RestoreSessionUseCase | null = null;
let _resend: ResendVerificationEmailUseCase | null = null;
let _verifyEmail: VerifyEmailUseCase | null = null;
let _requestPasswordReset: RequestPasswordResetUseCase | null = null;
let _resetPassword: ResetPasswordUseCase | null = null;

/**
 * Deep link the verification email lands on. Production: web universal link
 * claimed by AASA + assetlinks. Dev (Expo Go without universal links): a
 * custom scheme that opens the app directly.
 */
export const AUTH_VERIFY_URL =
  process.env.EXPO_PUBLIC_AUTH_VERIFY_URL ?? 'https://karma-community-kc.com/auth/verify';

export function getAuthService(): IAuthService {
  if (_authService) return _authService;
  const client = getSupabaseClient({ storage: pickAuthStorage() });
  _authService = new SupabaseAuthService(client);
  return _authService;
}

const openAuthSession: OpenAuthSession = async (url, redirectTo) => {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (result.type === 'success') return result.url;
  return null;
};

/** Random hex nonce. Apple receives SHA-256(nonce); Supabase verifies the raw value. */
function generateRawNonce(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isAppleCancellation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}

/**
 * FR-AUTH-004 (iOS). Drives the native Sign in with Apple sheet and returns the
 * identity token + raw nonce for Supabase, plus the first-authorization name
 * (Apple delivers it once). Resolves null when the user cancels the sheet.
 */
const performAppleSignIn: PerformAppleSignIn = async () => {
  const rawNonce = generateRawNonce();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return null;
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      identityToken: credential.identityToken,
      rawNonce,
      fullName: fullName.length > 0 ? fullName : null,
    };
  } catch (err) {
    if (isAppleCancellation(err)) return null;
    throw err;
  }
};

/** Deep link the OAuth provider redirects back to. Resolves per-platform via AuthSession. */
export function getOAuthRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'karmacommunity',
    path: 'auth/callback',
  });
}

/**
 * FR-AUTH-003 / FR-AUTH-007 (web).
 *
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
export async function redirectToGoogleSignInWeb(): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    throw new Error('redirectToGoogleSignInWeb: web-only');
  }
  const redirectTo = `${window.location.origin}/auth/callback`;
  const url = await getAuthService().getGoogleAuthUrl(redirectTo);
  window.location.assign(url);
}

export function getSignUpUseCase(): SignUpWithEmailUseCase {
  _signUp ??= new SignUpWithEmailUseCase(getAuthService());
  return _signUp;
}

export function getSignInUseCase(): SignInWithEmailUseCase {
  _signIn ??= new SignInWithEmailUseCase(getAuthService());
  return _signIn;
}

export function getSignInWithGoogleUseCase(): SignInWithGoogleUseCase {
  if (!_signInGoogle) {
    _signInGoogle = new SignInWithGoogleUseCase(getAuthService(), openAuthSession);
  }
  return _signInGoogle;
}

/** FR-AUTH-004 (iOS only). Native Sign in with Apple → Supabase id-token exchange. */
export function getSignInWithAppleUseCase(): SignInWithAppleUseCase {
  if (!_signInApple) {
    _signInApple = new SignInWithAppleUseCase(getAuthService(), performAppleSignIn);
  }
  return _signInApple;
}

export function getSignOutUseCase(): SignOutUseCase {
  _signOut ??= new SignOutUseCase(getAuthService());
  return _signOut;
}

export function getRestoreSessionUseCase(): RestoreSessionUseCase {
  if (!_restore) {
    // TD-68: cold-start restore consults the same server-side gate the 60s
    // in-session poll uses, so a suspended/banned user is signed out before
    // any session-scoped query runs.
    const gate = new SupabaseAccountGateRepository(getSupabaseClient({ storage: pickAuthStorage() }));
    _restore = new RestoreSessionUseCase(getAuthService(), gate);
  }
  return _restore;
}

export function getResendVerificationEmailUseCase(): ResendVerificationEmailUseCase {
  _resend ??= new ResendVerificationEmailUseCase(getAuthService());
  return _resend;
}

export function getVerifyEmailUseCase(): VerifyEmailUseCase {
  _verifyEmail ??= new VerifyEmailUseCase(getAuthService());
  return _verifyEmail;
}

/**
 * FR-AUTH-008: where the password-reset email link lands. The hosted
 * "Reset password" email template must point at this route with
 * `?token_hash={{ .TokenHash }}&type=recovery` (see `/auth/reset-password`).
 */
export const AUTH_RESET_PASSWORD_URL = `${webBaseUrl().replace(/\/+$/, '')}/auth/reset-password`;

export function getRequestPasswordResetUseCase(): RequestPasswordResetUseCase {
  _requestPasswordReset ??= new RequestPasswordResetUseCase(getAuthService());
  return _requestPasswordReset;
}

export function getResetPasswordUseCase(): ResetPasswordUseCase {
  _resetPassword ??= new ResetPasswordUseCase(getAuthService());
  return _resetPassword;
}

/** Used by the `/auth/callback` route to exchange an OAuth code for a session. */
export function exchangeOAuthCode(code: string): Promise<KcAuthSession> {
  return getAuthService().exchangeCodeForSession(code);
}

export function subscribeToSession(
  listener: (session: ReturnType<IAuthService['getCurrentSession']> extends Promise<infer S> ? S : never) => void,
): () => void {
  return getAuthService().onSessionChange(listener);
}
