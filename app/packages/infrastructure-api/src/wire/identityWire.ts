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

/**
 * Codes of the identity routes' refusals (`error.code` of the API's error body).
 * `invalid_refresh_token` covers every reason a refresh token does not work
 * (unknown, replaced, of a session that ended): the app signs the member out.
 */
export type IdentityErrorCode = 'invalid_request' | 'invalid_refresh_token' | 'not_configured' | 'too_many_requests' | 'unauthorized';
