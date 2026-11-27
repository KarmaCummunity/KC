import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, type JWTVerifyGetKey, SignJWT } from 'jose';

/** A stand-in for a provider: it signs ID tokens with a key of its own, and offers the public half as the provider publishes it. */
export interface TestProvider {
  readonly keys: JWTVerifyGetKey;
  /**
   * An ID token as the provider issues one.
   * @param claims What to say about the member; `iss`, `aud` and `sub` here replace the defaults.
   * @param options.expiresInSeconds Negative for a token that expired.
   * @param options.foreignKey Sign with a key the provider never published.
   */
  idToken(claims: JWTPayload, options?: { expiresInSeconds?: number; foreignKey?: boolean }): Promise<string>;
}

export const GOOGLE_CLIENT_ID = 'kc-web.apps.googleusercontent.test';
export const APPLE_CLIENT_ID = 'com.karmacommunity.app.test';

async function createProvider(issuer: string, audience: string): Promise<TestProvider> {
  const [own, foreign] = [await generateKeyPair('RS256'), await generateKeyPair('RS256')];
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(own.publicKey)), kid: 'provider-key', alg: 'RS256' }] });
  return {
    keys,
    idToken: (claims, options = {}) =>
      new SignJWT({ iss: issuer, aud: audience, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'provider-key' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 300))
        .sign(options.foreignKey ? foreign.privateKey : own.privateKey),
  };
}

export const createTestGoogle = (): Promise<TestProvider> => createProvider('https://accounts.google.com', GOOGLE_CLIENT_ID);
export const createTestApple = (): Promise<TestProvider> => createProvider('https://appleid.apple.com', APPLE_CLIENT_ID);

/** What Apple puts in a token for a nonce the app made: its SHA-256, in hex. */
export const appleNonceClaim = (rawNonce: string): string => createHash('sha256').update(rawNonce).digest('hex');
