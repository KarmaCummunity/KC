// ─────────────────────────────────────────────
// IAuthService — port for authentication providers.
// Mapped to SRS: FR-AUTH-003 (Google sign-up), FR-AUTH-006 (email sign-up),
// FR-AUTH-007 (sign-in, all paths), FR-AUTH-013 (cold-start restore), FR-AUTH-017 (sign-out).
// Adapter lives in @kc/infrastructure-supabase.
// docs/SSOT/spec/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

export interface AuthSession {
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // unix seconds
  /**
   * FR-AUTH-003 AC5 (interim, pre-`Profile`-table). Populated by the Supabase
   * adapter from `user.user_metadata.full_name` / `name`. `null` for users who
   * signed up without an SSO that returned a name (e.g. email/password).
   */
  readonly displayName: string | null;
  /**
   * FR-AUTH-003 AC5 (interim, pre-`Profile`-table). Populated by the Supabase
   * adapter from `user.user_metadata.avatar_url` / `picture`.
   */
  readonly avatarUrl: string | null;
  /**
   * Auth account creation time (ISO 8601), from Supabase `user.created_at`. Used only for the
   * time-to-first-post funnel metric (#1042). Optional: sessions built outside the adapter
   * (dev ghost session, fakes) may omit it.
   */
  readonly accountCreatedAt?: string | null;
}

/** Patch for `IAuthService.syncProfileMetadata` — mirrors `public.users` display fields. */
export interface AuthProfileMetadataPatch {
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
}

/**
 * FR-AUTH-004: Apple identity credential exchanged for a Supabase session.
 * Produced by the native Sign in with Apple sheet in the mobile composition root.
 */
export interface AppleIdentityCredential {
  /** Apple identity token (JWT) returned by the native authorization. */
  readonly identityToken: string;
  /** Un-hashed nonce; Supabase verifies SHA-256(rawNonce) against the token's claim. */
  readonly rawNonce: string;
}

export interface IAuthService {
  /**
   * Create a new credentialed user. Returns the active session, or null if
   * email-confirmation is pending. Pass `emailRedirectTo` to set the URL
   * Supabase places into `{{ .ConfirmationURL }}` in the verification email.
   */
  signUpWithEmail(
    email: string,
    password: string,
    options?: { emailRedirectTo?: string },
  ): Promise<AuthSession | null>;

  signInWithEmail(email: string, password: string): Promise<AuthSession>;

  signOut(): Promise<void>;

  getCurrentSession(): Promise<AuthSession | null>;

  onSessionChange(listener: (session: AuthSession | null) => void): () => void;

  getGoogleAuthUrl(redirectTo: string): Promise<string>;

  exchangeCodeForSession(code: string): Promise<AuthSession>;

  /**
   * FR-AUTH-004 (iOS Sign in with Apple). Exchange the Apple identity token from
   * the native authorization sheet for a Supabase session. Supabase auto-routes
   * by `sub`: a new Apple user is signed up, an existing one is signed in.
   */
  signInWithApple(credential: AppleIdentityCredential): Promise<AuthSession>;

  /**
   * FR-AUTH-006 (MVP gate): resend the signup verification email to `email`.
   * `emailRedirectTo` controls where the link lands after Supabase verifies the
   * token. Throws AuthError('rate_limited', ...) on too-frequent calls.
   */
  resendVerificationEmail(
    email: string,
    options?: { emailRedirectTo?: string },
  ): Promise<void>;

  /**
   * FR-AUTH-006 (MVP gate): exchange a verification token (from the email
   * link) for an authenticated session.
   */
  verifyEmail(tokenHash: string): Promise<AuthSession>;

  /**
   * FR-AUTH-008: email a password-reset link to `email`. Resolves for
   * unregistered addresses too (anti-enumeration, AC1). Throws
   * AuthError('rate_limited', ...) on too-frequent calls.
   */
  requestPasswordReset(email: string, options?: { redirectTo?: string }): Promise<void>;

  /**
   * FR-AUTH-008: exchange the single-use recovery token from the reset link
   * for a short-lived session that may change the password.
   */
  verifyPasswordRecovery(tokenHash: string): Promise<AuthSession>;

  /**
   * FR-AUTH-008 AC2/AC3: set the new password for the current (recovery)
   * session, then revoke every session of the user on every device.
   */
  updatePasswordAndSignOutEverywhere(newPassword: string): Promise<void>;

  /**
   * FR-PROFILE-007 / FR-AUTH-003 AC5: keep Supabase Auth `user_metadata` aligned with
   * `public.users` so cold-start `AuthSession` matches the profile the UI reads from DB.
   */
  syncProfileMetadata(patch: AuthProfileMetadataPatch): Promise<void>;
}
