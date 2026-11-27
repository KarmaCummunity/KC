import { createHmac } from 'node:crypto';
import { equalInConstantTime } from '../security/constantTime';

/**
 * A grant is what makes a URL of the local store "signed": the action it
 * allows, on which object, until when, authenticated with a keyed hash. It is
 * the local stand-in for a cloud store's signed URL, so development and tests
 * exercise the same flow.
 */
export interface StorageGrant {
  readonly action: 'upload' | 'read';
  readonly bucket: string;
  readonly name: string;
  /** Unix time in seconds after which the grant is void. */
  readonly expiresAt: number;
  /** Upload only: the content type the bytes must be sent with. */
  readonly contentType?: string;
  /** Upload only: the largest body, in bytes. */
  readonly maxBytes?: number;
  /** Upload only: the Cache-Control value to store. */
  readonly cacheControl?: string | null;
}

const signatureOf = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** A grant as one URL-safe token: `<payload>.<signature>`. */
export function signGrant(grant: StorageGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${signatureOf(payload, secret)}`;
}

/**
 * The grant a token carries, or null when the token was not signed with
 * `secret`, is malformed, or has expired.
 * @param nowSeconds Current Unix time in seconds.
 */
export function verifyGrant(token: string, secret: string, nowSeconds: number): StorageGrant | null {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  if (!equalInConstantTime(signature, signatureOf(payload, secret))) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StorageGrant;
    return typeof grant.expiresAt === 'number' && grant.expiresAt > nowSeconds ? grant : null;
  } catch {
    return null;
  }
}
