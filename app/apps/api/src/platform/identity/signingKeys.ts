import { createLocalJWKSet, importJWK, type JWK, type JWTVerifyGetKey } from 'jose';

/** Injection token of this API's own `SigningKeySet`, or of null when another service issues the tokens. */
export const SIGNING_KEYS = Symbol('SIGNING_KEYS');

/** The one algorithm KC signs access tokens with: ECDSA on P-256 with SHA-256. */
export const SIGNING_ALGORITHM = 'ES256';

/** The keys KC signs and verifies its access tokens with (ADR-013 section 2). */
export interface SigningKeySet {
  /** Id of the key new tokens are signed with; it is in every token's header. */
  readonly signingKeyId: string;
  /** The private half of that key. Never leaves the process. */
  readonly signingKey: CryptoKey;
  /** The public halves of every key, as published: a token signed by any of them verifies. */
  readonly publicKeys: readonly JWK[];
  /** Resolves a token's key among the published ones. */
  readonly verificationKeys: JWTVerifyGetKey;
}

/** The configured signing keys are not a usable key set. The message never contains key material. */
export class InvalidSigningKeysError extends Error {
  constructor(reason: string) {
    super(`Invalid signing keys: ${reason}`);
    this.name = 'InvalidSigningKeysError';
  }
}

/** What a public P-256 key consists of; everything else in a configured key (above all `d`) is left out when it is published. */
function publicHalfOf(key: JWK): JWK {
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, kid: key.kid, alg: SIGNING_ALGORITHM, use: 'sig' } as JWK;
}

function isPrivateP256(key: JWK): boolean {
  return key.kty === 'EC' && key.crv === 'P-256' && [key.x, key.y, key.d, key.kid].every((part) => typeof part === 'string' && part !== '');
}

/**
 * Reads a set of private keys in JWK Set form: `{"keys":[{…},{…}]}`. The
 * first key signs; all of them verify, so a key is rotated by putting the
 * new one first and removing the old one once no token it signed is still
 * valid.
 * @throws InvalidSigningKeysError when the text is not such a set: every key must be a private P-256 key with an id of its own.
 */
export async function loadSigningKeys(jwkSetJson: string): Promise<SigningKeySet> {
  let keys: unknown;
  try {
    keys = (JSON.parse(jwkSetJson) as { keys?: unknown }).keys;
  } catch {
    throw new InvalidSigningKeysError('not JSON');
  }
  if (!Array.isArray(keys) || keys.length === 0) throw new InvalidSigningKeysError('no keys');
  const jwks = keys as JWK[];
  if (!jwks.every(isPrivateP256)) throw new InvalidSigningKeysError('every key must be a private P-256 key with a kid');
  if (new Set(jwks.map((key) => key.kid)).size !== jwks.length) throw new InvalidSigningKeysError('two keys share a kid');
  const first = jwks[0]!;
  let signingKey: CryptoKey;
  try {
    signingKey = (await importJWK(first, SIGNING_ALGORITHM)) as CryptoKey;
  } catch {
    throw new InvalidSigningKeysError('the first key cannot be used to sign');
  }
  const publicKeys = jwks.map(publicHalfOf);
  return { signingKeyId: first.kid as string, signingKey, publicKeys, verificationKeys: createLocalJWKSet({ keys: publicKeys }) };
}
