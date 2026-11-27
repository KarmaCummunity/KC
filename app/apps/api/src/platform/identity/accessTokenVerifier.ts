import { errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { CallerIdentity } from './callerIdentity';

/** Injection token of the `AccessTokenVerifier`. */
export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

/** Turns a bearer token into the caller it proves, or rejects it. */
export interface AccessTokenVerifier {
  /** @throws InvalidAccessTokenError when the token does not prove a signed-in user. */
  verify(token: string): Promise<CallerIdentity>;
}

/** The token is missing something, expired, forged or not meant for this API. */
export class InvalidAccessTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid access token: ${reason}`);
    this.name = 'InvalidAccessTokenError';
  }
}

/** Audience and role of a signed-in user's token; the same value for both. */
const SIGNED_IN = 'authenticated';
/** Asymmetric algorithms only: the API holds no signing secret, so it cannot mint tokens. */
const ACCEPTED_ALGORITHMS = ['ES256', 'RS256'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds a verifier for tokens of one issuer.
 * @param keys Resolves the issuer's public signing keys (a remote key set in
 *   production, a local one in tests).
 * @param issuer Expected `iss` claim, compared exactly.
 */
export function createAccessTokenVerifier(keys: JWTVerifyGetKey, issuer: string): AccessTokenVerifier {
  return {
    async verify(token) {
      const payload = await jwtVerify(token, keys, {
        issuer,
        audience: SIGNED_IN,
        algorithms: ACCEPTED_ALGORITHMS,
        requiredClaims: ['sub', 'exp'],
      }).then(
        (result) => result.payload,
        (error: unknown) => {
          // Not reaching the key set says nothing about the token: let it
          // surface as a server fault instead of telling the user to sign in again.
          if (!(error instanceof errors.JOSEError) || error instanceof errors.JWKSTimeout) throw error;
          throw new InvalidAccessTokenError(error.code);
        },
      );

      // The audience alone is not enough: the database role is taken from here.
      if (payload.role !== SIGNED_IN) throw new InvalidAccessTokenError('role is not a signed-in user');
      if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
        throw new InvalidAccessTokenError('subject is not a user id');
      }
      return { userId: payload.sub, claims: payload };
    },
  };
}
