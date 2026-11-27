// ─────────────────────────────────────────────
// SupabaseAuthService — adapter for IAuthService backed by @supabase/supabase-js.
// Mapped to SRS: FR-AUTH-003 (Google sign-up), FR-AUTH-006 (email sign-up),
// FR-AUTH-007 (sign-in, all paths), FR-AUTH-013 (cold-start restore), FR-AUTH-017 (sign-out).
// docs/spec/requirements/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AuthError,
  type AppleIdentityCredential,
  type AuthProfileMetadataPatch,
  type AuthSession,
  type IAuthService,
} from '@kc/application';
import { mapAuthError } from './mapAuthError';
import { buildAuthMetadataPayload, toSession } from './mapSupabaseSession';
import { SupabaseAuthOAuth } from './supabaseAuthOAuth';

export class SupabaseAuthService implements IAuthService {
  private readonly oauth: SupabaseAuthOAuth;

  constructor(private readonly client: SupabaseClient) {
    this.oauth = new SupabaseAuthOAuth(client);
  }

  async signUpWithEmail(
    email: string,
    password: string,
    options?: { emailRedirectTo?: string },
  ): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: options?.emailRedirectTo },
    });
    if (error) {
      const mapped = mapAuthError(error);
      // TD-69: never reveal that the email is already registered. Treat it as
      // a pending-verification success — the caller already routes a null
      // session to the "check your email" panel (FR-AUTH-006 AC2).
      if (mapped.code === 'email_already_in_use') return null;
      throw mapped;
    }
    return data.session ? toSession(data.session) : null;
  }

  async signInWithEmail(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      const mapped = mapAuthError(error);
      // TD-69: collapse credentialed-sign-in failures to a generic code so a
      // scripted attacker can't tell whether the email is registered.
      if (mapped.code === 'invalid_credentials' || mapped.code === 'email_already_in_use') {
        throw new AuthError('authentication_failed', error.message, error);
      }
      throw mapped;
    }
    if (!data.session) {
      throw new AuthError('unknown', 'sign_in_no_session');
    }
    return toSession(data.session);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (!error) return;
    // The server revoke failed (offline, timeout). supabase-js keeps the stored session in that
    // case, so drop it locally: the user must be signed out on this device regardless of network.
    const { error: localError } = await this.client.auth.signOut({ scope: 'local' });
    if (localError) throw mapAuthError(localError);
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapAuthError(error);
    return data.session ? toSession(data.session) : null;
  }

  onSessionChange(listener: (session: AuthSession | null, event?: string) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      listener(session ? toSession(session) : null, event);
    });
    return () => data.subscription.unsubscribe();
  }

  getGoogleAuthUrl(redirectTo: string): Promise<string> {
    return this.oauth.getGoogleAuthUrl(redirectTo);
  }

  exchangeCodeForSession(code: string): Promise<AuthSession> {
    return this.oauth.exchangeCodeForSession(code);
  }

  signInWithApple(credential: AppleIdentityCredential): Promise<AuthSession> {
    return this.oauth.signInWithApple(credential);
  }

  signInWithGoogleIdToken(idToken: string): Promise<AuthSession> {
    return this.oauth.signInWithGoogleIdToken(idToken);
  }

  async resendVerificationEmail(
    email: string,
    options?: { emailRedirectTo?: string },
  ): Promise<void> {
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: options?.emailRedirectTo },
    });
    if (error) throw mapAuthError(error);
  }

  async verifyEmail(tokenHash: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.verifyOtp({
      type: 'signup',
      token_hash: tokenHash,
    });
    if (error) throw mapAuthError(error);
    if (!data.session) throw new AuthError('unknown', 'verify_no_session');
    return toSession(data.session);
  }

  async requestPasswordReset(email: string, options?: { redirectTo?: string }): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: options?.redirectTo,
    });
    if (error) throw mapAuthError(error);
  }

  async verifyPasswordRecovery(tokenHash: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    });
    if (error) throw mapAuthError(error);
    if (!data.session) throw new AuthError('unknown', 'recovery_no_session');
    return toSession(data.session);
  }

  async updatePasswordAndSignOutEverywhere(newPassword: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw mapAuthError(error);
    // FR-AUTH-008 AC2/AC3: revoke every refresh token of the user, on all devices.
    const { error: signOutError } = await this.client.auth.signOut({ scope: 'global' });
    if (signOutError) throw mapAuthError(signOutError);
  }

  async syncProfileMetadata(patch: AuthProfileMetadataPatch): Promise<void> {
    const data = buildAuthMetadataPayload(patch);
    if (Object.keys(data).length === 0) return;
    const { error } = await this.client.auth.updateUser({ data });
    if (error) throw mapAuthError(error);
  }
}
