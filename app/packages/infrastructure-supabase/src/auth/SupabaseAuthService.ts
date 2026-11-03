// ─────────────────────────────────────────────
// SupabaseAuthService — adapter for IAuthService backed by @supabase/supabase-js.
// Mapped to SRS: FR-AUTH-003 (Google sign-up), FR-AUTH-006 (email sign-up),
// FR-AUTH-007 (sign-in, all paths), FR-AUTH-013 (cold-start restore), FR-AUTH-017 (sign-out).
// docs/SSOT/spec/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import type { SupabaseClient, Session as SbSession } from '@supabase/supabase-js';
import {
  AuthError,
  type AppleIdentityCredential,
  type AuthProfileMetadataPatch,
  type AuthSession,
  type IAuthService,
} from '@kc/application';
import { mapAuthError } from './mapAuthError';

export class SupabaseAuthService implements IAuthService {
  private activeExchangeCode: string | null = null;
  private activeExchangePromise: Promise<AuthSession> | null = null;

  constructor(private readonly client: SupabaseClient) {}

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
    if (error) throw mapAuthError(error);
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapAuthError(error);
    return data.session ? toSession(data.session) : null;
  }

  onSessionChange(listener: (session: AuthSession | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(session ? toSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async getGoogleAuthUrl(redirectTo: string): Promise<string> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { 
        redirectTo, 
        skipBrowserRedirect: true,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });
    if (error) throw mapAuthError(error);
    if (!data.url) throw new AuthError('unknown', 'oauth_no_url');
    return data.url;
  }

  async exchangeCodeForSession(code: string): Promise<AuthSession> {
    if (this.activeExchangeCode === code && this.activeExchangePromise) {
      return this.activeExchangePromise;
    }
    
    this.activeExchangeCode = code;
    this.activeExchangePromise = (async () => {
      const { data, error } = await this.client.auth.exchangeCodeForSession(code);
      if (error) throw mapAuthError(error);
      if (!data.session) throw new AuthError('unknown', 'oauth_no_session');
      return toSession(data.session);
    })().finally(() => {
      if (this.activeExchangeCode === code) {
        this.activeExchangePromise = null;
        this.activeExchangeCode = null;
      }
    });
    
    return this.activeExchangePromise;
  }

  async signInWithApple(credential: AppleIdentityCredential): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: credential.rawNonce,
    });
    if (error) throw mapAuthError(error);
    if (!data.session) throw new AuthError('unknown', 'apple_no_session');
    return toSession(data.session);
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

/** Maps profile fields to keys read by `toSession` (full_name/name, avatar_url/picture). */
function buildAuthMetadataPayload(patch: AuthProfileMetadataPatch): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  if (patch.displayName !== undefined) {
    const name = patch.displayName.trim();
    data.full_name = name;
    data.name = name;
  }
  if (patch.avatarUrl !== undefined) {
    data.avatar_url = patch.avatarUrl;
    data.picture = patch.avatarUrl;
  }
  return data;
}

function toSession(s: SbSession): AuthSession {
  const meta = (s.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: s.user.id,
    email: s.user.email ?? null,
    emailVerified: Boolean(s.user.email_confirmed_at),
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
    displayName: pickString(meta, ['full_name', 'name']),
    avatarUrl: pickString(meta, ['avatar_url', 'picture']),
    accountCreatedAt: s.user.created_at ?? null,
  };
}

function pickString(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

