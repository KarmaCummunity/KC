// ─────────────────────────────────────────────
// Composition root — wires Supabase adapter into application use cases.
// Lives in the mobile app (composition root); not in /domain or /application.
// Mapped to SRS: FR-AUTH-003 (Google sign-up), FR-AUTH-006 (email sign-up),
// FR-AUTH-007 (sign-in, all paths), FR-AUTH-013 (cold-start restore), FR-AUTH-017 (sign-out).
// docs/spec/requirements/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import { Platform } from 'react-native';
import { pickAuthStorage } from './authSecureStorage';
import {
  getSupabaseClient,
  SupabaseAccountGateRepository,
  SupabaseAuthService,
} from '@kc/infrastructure-supabase';
import {
  RestoreSessionUseCase,
  SignInWithEmailUseCase,
  SignInWithGoogleUseCase,
  SignInWithGoogleNativeUseCase,
  SignInWithAppleUseCase,
  SignOutUseCase,
  SignUpWithEmailUseCase,
  ResendVerificationEmailUseCase,
  VerifyEmailUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  type AuthSession as KcAuthSession,
  type IAuthService,
} from '@kc/application';
import Constants from 'expo-constants';
import { webBaseUrl } from '../config/featureFlags';
import { resolveGoogleNativeSignInConfig } from '../lib/auth/googleNativeSignInConfig';
import { createGoogleIdTokenRequester } from './googleNativeSignIn';
import { performAppleSignIn } from './appleNativeSignIn';
import { openAuthSession } from './authBrowserSession';
import { redirectToGoogleSignInWeb as redirectToGoogleSignInWebImpl } from './authGoogleWebRedirect';
import { reportUnexpectedSignOut } from '../lib/observability/reportAuthEvent';

export { getOAuthRedirectUri } from './authBrowserSession';

let _authService: IAuthService | null = null;
let _signUp: SignUpWithEmailUseCase | null = null;
let _signIn: SignInWithEmailUseCase | null = null;
let _signInGoogle: SignInWithGoogleUseCase | SignInWithGoogleNativeUseCase | null = null;
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

/**
 * FR-AUTH-003 / FR-AUTH-007 (web). Same-tab Google redirect; see authGoogleWebRedirect.
 */
export async function redirectToGoogleSignInWeb(): Promise<void> {
  return redirectToGoogleSignInWebImpl(getAuthService());
}

export function getSignUpUseCase(): SignUpWithEmailUseCase {
  _signUp ??= new SignUpWithEmailUseCase(getAuthService());
  return _signUp;
}

export function getSignInUseCase(): SignInWithEmailUseCase {
  _signIn ??= new SignInWithEmailUseCase(getAuthService());
  return _signIn;
}

/** Native platforms; web uses `redirectToGoogleSignInWeb`. #1955: native sheet when configured, else browser. */
export function getSignInWithGoogleUseCase(): SignInWithGoogleUseCase | SignInWithGoogleNativeUseCase {
  if (_signInGoogle) return _signInGoogle;
  const browserFlow = new SignInWithGoogleUseCase(getAuthService(), openAuthSession);
  const native = resolveGoogleNativeSignInConfig(Platform.OS, Constants.expoConfig?.extra);
  _signInGoogle = native
    ? new SignInWithGoogleNativeUseCase(getAuthService(), createGoogleIdTokenRequester(native), browserFlow)
    : browserFlow;
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
  return getAuthService().onSessionChange((session, event) => {
    reportUnexpectedSignOut(event);
    listener(session);
  });
}
