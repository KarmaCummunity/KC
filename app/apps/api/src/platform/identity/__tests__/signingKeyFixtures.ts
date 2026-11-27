import { exportJWK, generateKeyPair, type JWK } from 'jose';

/** A fresh private P-256 key in JWK form, with the given id. */
export async function privateJwk(kid: string): Promise<JWK> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  return { ...(await exportJWK(privateKey)), kid };
}

/** A JWK Set, as the API is configured with, of fresh keys with the given ids; the first signs. */
export async function signingKeySetJson(...kids: string[]): Promise<string> {
  return JSON.stringify({ keys: await Promise.all(kids.map(privateJwk)) });
}
