// The wire format of KC's own identity routes (ADR-013), shared by the API and the app so
// neither can drift from the other: the routes, their bodies and their error codes.

/** Paths of the identity routes, relative to the API base URL. */
export const IDENTITY_PATHS = {
  /** Exchanges a refresh token for a new session: `RefreshRequest` → `SessionResponse`. */
  token: '/v1/auth/token',
  /** Ends the caller's session, or all of them: `SignOutRequest` → `{}`. Needs the access token. */
  signOut: '/v1/auth/sign-out',
  /** The public keys access tokens verify against, as a JWK Set. */
  keySet: '/v1/auth/.well-known/jwks.json',
  /** Creates an account with an email address and a password: `EmailSignUpRequest` → `{}`, whether or not the address was free. */
  signUp: '/v1/auth/sign-up',
  /** Signs in with an email address and a password: `EmailSignInRequest` → `SessionResponse`. */
  signIn: '/v1/auth/sign-in',
  /** Redeems the link of an email: `VerifyLinkRequest` → `SessionResponse`. */
  verify: '/v1/auth/verify',
  /** Sends the verification email again: `EmailLinkRequest` → `{}`, whatever the address. */
  resend: '/v1/auth/resend',
  /** Sends a password reset email: `EmailLinkRequest` → `{}`, whatever the address. */
  recover: '/v1/auth/recover',
  /** Sets the caller's password and ends every session they have: `SetPasswordRequest` → `{}`. Needs the access token. */
  password: '/v1/auth/password',
  /** Updates the name and picture of the caller's sign-in profile: `ProfileRequest` → `{}`. Needs the access token. */
  profile: '/v1/auth/profile',
} as const;

/** The member a session belongs to, as the app's `AuthSession` needs them. */
export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
  /** Whether the address was confirmed (by its link, or vouched for by Google or Apple). */
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  /** ISO time the account was created. */
  readonly createdAt: string;
  /** How the account was created: `google`, `apple` or `email`; null when not recorded. */
  readonly provider: string | null;
}

/** What every route that signs a member in, or refreshes them, answers with. */
export interface SessionResponse {
  readonly accessToken: string;
  /** Replaces the refresh token that was presented: each one works once. */
  readonly refreshToken: string;
  /** When the access token stops being valid, in seconds since the epoch. */
  readonly expiresAt: number;
  readonly user: SessionUser;
}

export interface RefreshRequest {
  readonly refreshToken: string;
}

export interface SignOutRequest {
  /** `device`: the session the access token belongs to. `everywhere`: every session of the member. */
  readonly scope: 'device' | 'everywhere';
}

export interface EmailSignInRequest {
  readonly email: string;
  readonly password: string;
}

export interface EmailSignUpRequest extends EmailSignInRequest {
  /** Where the verification link leads; one of the addresses the API is configured to allow. */
  readonly redirectTo: string;
}

export interface EmailLinkRequest {
  readonly email: string;
  /** Where the link leads; one of the addresses the API is configured to allow. */
  readonly redirectTo: string;
}

/** The query parameter a link carries its one-time token in, and the one that says what the link is for. */
export const LINK_TOKEN_PARAMETER = 'token_hash';
export const LINK_TYPE_PARAMETER = 'type';

export interface VerifyLinkRequest {
  /** The token of the link, as it arrived. */
  readonly token: string;
  /** `signup`: an address is being verified. `recovery`: a password is being reset. */
  readonly type: 'signup' | 'recovery';
}

export interface SetPasswordRequest {
  readonly password: string;
}

export interface ProfileRequest {
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

/**
 * Codes of the identity routes' refusals (`error.code` of the API's error body).
 * `invalid_refresh_token` covers every reason a refresh token does not work
 * (unknown, replaced, of a session that ended): the app signs the member out.
 */
export type IdentityErrorCode =
  | 'invalid_request'
  | 'invalid_refresh_token'
  /** The address and password do not sign anyone in; never says which of the two is wrong. */
  | 'invalid_credentials'
  /** The password was right and the address is not verified yet. */
  | 'email_not_confirmed'
  /** The link was used already, expired, or was never issued. */
  | 'invalid_link'
  | 'weak_password'
  | 'not_configured'
  | 'too_many_requests'
  | 'unauthorized';
