// OAuth URL, PKCE code exchange, and native ID-token sign-in for SupabaseAuthService.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AuthError,
  type AppleIdentityCredential,
  type AuthSession,
} from '@kc/application';
import { mapAuthError } from './mapAuthError';
import { toSession } from './mapSupabaseSession';

/** Deduplicates in-flight `exchangeCodeForSession` calls for the same code. */
export class SupabaseAuthOAuth {
  private activeExchangeCode: string | null = null;
  private activeExchangePromise: Promise<AuthSession> | null = null;

  constructor(private readonly client: SupabaseClient) {}

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

  // No nonce: the native Google SDK doesn't expose one, so the Supabase Google
  // provider must run with nonce checks skipped (#1955).
  async signInWithGoogleIdToken(idToken: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw mapAuthError(error);
    if (!data.session) throw new AuthError('unknown', 'google_no_session');
    return toSession(data.session);
  }
}
