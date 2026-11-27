// The ID tokens of the providers a member can sign in through (ADR-013 section 3). A token is
// accepted when the provider signed it, for one of KC's own client ids, and it has not expired;
// what it says about the member is then the provider's word.

import { createHash } from 'node:crypto';
import { errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';

export type SignInProvider = 'google' | 'apple';

/** Where each provider publishes the keys it signs ID tokens with. */
export const PROVIDER_KEYS_URL: Readonly<Record<SignInProvider, string>> = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
};

/** Google signs under either spelling of its name. */
const ISSUERS: Readonly<Record<SignInProvider, string[]>> = {
  google: ['https://accounts.google.com', 'accounts.google.com'],
  apple: ['https://appleid.apple.com'],
};

/** Who an ID token says the member is. */
export interface ProviderAccount {
  readonly provider: SignInProvider;
  /** The provider's own id of the account: stable, and never reused for another person. */
  readonly subject: string;
  readonly email: string | null;
  /** Whether the provider vouches that the address is the account holder's. */
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

/** The token is not one of this provider for KC, or it expired. The reason is for the log. */
export class InvalidProviderTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid provider token: ${reason}`);
    this.name = 'InvalidProviderTokenError';
  }
}

export interface ProviderTokenVerifier {
  /**
   * @param nonce The value the app made for this sign-in, when the provider bound the token to one.
   * @throws InvalidProviderTokenError. A failure to reach the provider's keys is rethrown as it is: it says nothing about the token.
   */
  verify(token: string, nonce?: string): Promise<ProviderAccount>;
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
/** Apple writes the flag as the text "true" in some tokens. */
const isTrue = (value: unknown): boolean => value === true || value === 'true';

async function verified(token: string, keys: JWTVerifyGetKey, provider: SignInProvider, clientIds: readonly string[]): Promise<JWTPayload> {
  // Without a client id of KC's, every token of the provider would be "for" this API.
  if (clientIds.length === 0) throw new InvalidProviderTokenError(`${provider} sign-in is not configured`);
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: ISSUERS[provider], audience: [...clientIds], algorithms: ['RS256'], requiredClaims: ['sub', 'exp'] });
    return payload;
  } catch (error) {
    if (!(error instanceof errors.JOSEError) || error instanceof errors.JWKSTimeout) throw error;
    throw new InvalidProviderTokenError(error.code);
  }
}

/** Google ID tokens, from the native sheet or the browser flow. Google's own flows bind no nonce the app could check, so none is asked for. */
export function createGoogleTokenVerifier(keys: JWTVerifyGetKey, clientIds: readonly string[]): ProviderTokenVerifier {
  return {
    async verify(token) {
      const claims = await verified(token, keys, 'google', clientIds);
      return {
        provider: 'google',
        subject: claims.sub as string,
        email: textOrNull(claims.email),
        emailVerified: isTrue(claims.email_verified),
        displayName: textOrNull(claims.name),
        avatarUrl: textOrNull(claims.picture),
      };
    },
  };
}

/**
 * Apple ID tokens from the native sheet. The app makes a random nonce, gives
 * Apple its SHA-256, and sends the nonce itself along with the token: only
 * the app instance that started the sign-in can present a token that matches,
 * so a token lifted from somewhere else is refused. Apple puts the member's
 * name in no token; the app sets it afterwards.
 */
export function createAppleTokenVerifier(keys: JWTVerifyGetKey, clientIds: readonly string[]): ProviderTokenVerifier {
  return {
    async verify(token, nonce) {
      const claims = await verified(token, keys, 'apple', clientIds);
      if (!nonce || claims.nonce !== createHash('sha256').update(nonce).digest('hex')) throw new InvalidProviderTokenError('nonce does not match');
      return { provider: 'apple', subject: claims.sub as string, email: textOrNull(claims.email), emailVerified: isTrue(claims.email_verified), displayName: null, avatarUrl: null };
    },
  };
}
