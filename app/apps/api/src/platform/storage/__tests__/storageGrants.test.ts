import { describe, expect, it } from 'vitest';
import { signGrant, type StorageGrant, verifyGrant } from '../storageGrants';

const SECRET = 'grant-secret';
const NOW = 1_800_000_000;
const GRANT: StorageGrant = { action: 'upload', bucket: 'avatars', name: 'u1/a.jpg', expiresAt: NOW + 60, contentType: 'image/jpeg', maxBytes: 1024, cacheControl: null };

describe('storage grants', () => {
  it('gives back the grant a token was signed with', () => {
    expect(verifyGrant(signGrant(GRANT, SECRET), SECRET, NOW)).toEqual(GRANT);
  });

  it('refuses a token signed with another key', () => {
    expect(verifyGrant(signGrant(GRANT, 'another-secret'), SECRET, NOW)).toBeNull();
  });

  it('refuses a grant whose payload was changed after signing', () => {
    const [, signature] = signGrant(GRANT, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...GRANT, name: 'u2/a.jpg' })).toString('base64url');

    expect(verifyGrant(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('refuses a grant at and after its expiry', () => {
    const token = signGrant(GRANT, SECRET);

    expect(verifyGrant(token, SECRET, GRANT.expiresAt - 1)).toEqual(GRANT);
    expect(verifyGrant(token, SECRET, GRANT.expiresAt)).toBeNull();
  });

  it.each(['', 'no-dot', 'a.b.c', '.signature', 'payload.'])('refuses the malformed token "%s"', (token) => {
    expect(verifyGrant(token, SECRET, NOW)).toBeNull();
  });

  it('refuses a correctly signed payload that is not a grant', () => {
    const payload = Buffer.from('not json').toString('base64url');
    const [, signature] = signGrant(GRANT, SECRET).split('.');

    expect(verifyGrant(`${payload}.${signature}`, SECRET, NOW)).toBeNull();
  });
});
