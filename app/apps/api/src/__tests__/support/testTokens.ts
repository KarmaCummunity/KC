import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { type AccessTokenVerifier, createAccessTokenVerifier } from '../../platform/identity/accessTokenVerifier';
import { TEST_AUTH_ISSUER } from './testConfig';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

/** What a test may change about a token; everything else is a valid default. */
export interface TokenOverrides {
  readonly claims?: JWTPayload;
  readonly issuer?: string;
  readonly audience?: string;
  /** Seconds from now; negative for an expired token. */
  readonly expiresInSeconds?: number;
  /** Sign with a key the verifier does not know. */
  readonly foreignKey?: boolean;
}

/** A local issuer: signs tokens and verifies them with its own public key. No network. */
export interface TestIssuer {
  readonly verifier: AccessTokenVerifier;
  sign(userId: string, overrides?: TokenOverrides): Promise<string>;
}

export async function createTestIssuer(): Promise<TestIssuer> {
  const trusted = await generateKeyPair('ES256');
  const foreign = await generateKeyPair('ES256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(trusted.publicKey)), kid: 'test-key', alg: 'ES256' }] });

  return {
    verifier: createAccessTokenVerifier(keys, TEST_AUTH_ISSUER),
    sign(userId, overrides = {}) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      return new SignJWT({ role: 'authenticated', ...overrides.claims })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setSubject(userId)
        .setIssuer(overrides.issuer ?? TEST_AUTH_ISSUER)
        .setAudience(overrides.audience ?? 'authenticated')
        .setExpirationTime(nowSeconds + (overrides.expiresInSeconds ?? 300))
        .sign(overrides.foreignKey ? foreign.privateKey : trusted.privateKey);
    },
  };
}
