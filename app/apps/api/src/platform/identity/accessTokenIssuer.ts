import { SignJWT } from 'jose';
import { SIGNING_ALGORITHM, type SigningKeySet } from './signingKeys';

/** Injection token of the `AccessTokenIssuer`, or of null when this API does not issue tokens. */
export const ACCESS_TOKEN_ISSUER = Symbol('ACCESS_TOKEN_ISSUER');

/** How long an access token is valid: one hour, as the tokens the app receives today. */
export const ACCESS_TOKEN_SECONDS = 3600;

/** Audience and role of a signed-in member's token; the database role is taken from the role claim. */
const SIGNED_IN = 'authenticated';

export interface IssuedAccessToken {
  readonly token: string;
  /** When the token stops being valid, in seconds since the epoch. */
  readonly expiresAt: number;
}

/** Signs the access tokens of KC's own members (ADR-013 section 2). */
export interface AccessTokenIssuer {
  /**
   * A token that proves `userId` for one hour, as part of one session.
   * It carries exactly the claims the API and the database read (`sub`,
   * `role`, `aud`, `iss`, `iat`, `exp`) and the session's id (`sid`).
   */
  issue(member: { readonly userId: string; readonly sessionId: string }): Promise<IssuedAccessToken>;
}

/**
 * @param issuer The `iss` claim: the address this API's identity routes are served under.
 * @param nowSeconds The current time in seconds since the epoch; replaced in tests.
 */
export function createAccessTokenIssuer(keys: SigningKeySet, issuer: string, nowSeconds: () => number = () => Math.floor(Date.now() / 1000)): AccessTokenIssuer {
  return {
    async issue({ userId, sessionId }) {
      const issuedAt = nowSeconds();
      const expiresAt = issuedAt + ACCESS_TOKEN_SECONDS;
      const token = await new SignJWT({ role: SIGNED_IN, sid: sessionId })
        .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: keys.signingKeyId, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(SIGNED_IN)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(keys.signingKey);
      return { token, expiresAt };
    },
  };
}
