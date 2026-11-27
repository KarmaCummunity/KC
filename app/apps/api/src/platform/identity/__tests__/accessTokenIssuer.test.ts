import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_SECONDS, createAccessTokenIssuer } from '../accessTokenIssuer';
import { createAccessTokenVerifier, InvalidAccessTokenError } from '../accessTokenVerifier';
import { loadSigningKeys } from '../signingKeys';
import { signingKeySetJson } from './signingKeyFixtures';

const ISSUER = 'https://api.kc.test/v1/auth';
const MEMBER = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '99999999-9999-4999-8999-999999999999' };

describe('createAccessTokenIssuer', () => {
  it('issues a token the API\'s own verifier accepts as that member, with the session it belongs to', async () => {
    const keys = await loadSigningKeys(await signingKeySetJson('k1'));

    const issued = await createAccessTokenIssuer(keys, ISSUER).issue(MEMBER);
    const caller = await createAccessTokenVerifier(keys.verificationKeys, ISSUER).verify(issued.token);

    expect(caller.userId).toBe(MEMBER.userId);
    expect(caller.claims).toMatchObject({ sub: MEMBER.userId, sid: MEMBER.sessionId, role: 'authenticated', aud: 'authenticated', iss: ISSUER });
  });

  it('carries exactly the claims that are read, is valid for one hour, and names the key that signed it', async () => {
    const keys = await loadSigningKeys(await signingKeySetJson('k1', 'k0'));
    const now = 1_800_000_000;

    const issued = await createAccessTokenIssuer(keys, ISSUER, () => now).issue(MEMBER);

    expect(issued.expiresAt).toBe(now + ACCESS_TOKEN_SECONDS);
    expect(decodeJwt(issued.token)).toEqual({ sub: MEMBER.userId, sid: MEMBER.sessionId, role: 'authenticated', aud: 'authenticated', iss: ISSUER, iat: now, exp: now + 3600 });
    expect(decodeProtectedHeader(issued.token)).toEqual({ alg: 'ES256', kid: 'k1', typ: 'JWT' });
  });

  it('is refused by a verifier of another issuer or of other keys', async () => {
    const keys = await loadSigningKeys(await signingKeySetJson('k1'));
    const others = await loadSigningKeys(await signingKeySetJson('k1'));
    const { token } = await createAccessTokenIssuer(keys, ISSUER).issue(MEMBER);

    await expect(createAccessTokenVerifier(keys.verificationKeys, 'https://elsewhere.test/v1/auth').verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(createAccessTokenVerifier(others.verificationKeys, ISSUER).verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });
});
