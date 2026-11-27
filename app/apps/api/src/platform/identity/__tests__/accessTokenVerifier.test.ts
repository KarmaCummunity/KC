import { errors, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestIssuer, type TestIssuer, type TokenOverrides, USER_A } from '../../../__tests__/support/testTokens';
import { TEST_AUTH_ISSUER } from '../../../__tests__/support/testConfig';
import { createAccessTokenVerifier, InvalidAccessTokenError } from '../accessTokenVerifier';

describe('access token verification', () => {
  let issuer: TestIssuer;

  beforeAll(async () => {
    issuer = await createTestIssuer();
  });

  it('accepts a valid token and returns the caller with the verified claims', async () => {
    const token = await issuer.sign(USER_A, { claims: { email: 'a@kc.test' } });

    const identity = await issuer.verifier.verify(token);

    expect(identity.userId).toBe(USER_A);
    expect(identity.claims).toMatchObject({ sub: USER_A, role: 'authenticated', email: 'a@kc.test' });
  });

  const rejected: ReadonlyArray<[string, string, TokenOverrides]> = [
    ['an expired token', USER_A, { expiresInSeconds: -60 }],
    ['a token signed by an unknown key', USER_A, { foreignKey: true }],
    ['a token of another issuer', USER_A, { issuer: 'https://evil.test/auth/v1' }],
    ['a token for another audience', USER_A, { audience: 'anon' }],
    ['a token whose role is not a signed-in user', USER_A, { claims: { role: 'service_role' } }],
    ['a token whose subject is not a user id', 'not-a-uuid', {}],
  ];

  it.each(rejected)('rejects %s', async (_case, subject, overrides) => {
    const token = await issuer.sign(subject, overrides);

    await expect(issuer.verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects text that is not a token', async () => {
    await expect(issuer.verifier.verify('not.a.token')).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token signed with a shared secret, even a correct-looking one', async () => {
    // Accepting HS256 would let anyone who learns a secret mint tokens.
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_A)
      .setIssuer(TEST_AUTH_ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-enough-length-000'));

    await expect(issuer.verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('does not blame the token when the key set cannot be reached', async () => {
    const unreachable = createAccessTokenVerifier(() => Promise.reject(new errors.JWKSTimeout()), TEST_AUTH_ISSUER);
    const token = await issuer.sign(USER_A);

    await expect(unreachable.verify(token)).rejects.toBeInstanceOf(errors.JWKSTimeout);
  });

  it('lets an unexpected failure through unchanged', async () => {
    const failure = new TypeError('fetch failed');
    const broken = createAccessTokenVerifier(() => Promise.reject(failure), TEST_AUTH_ISSUER);

    await expect(broken.verify(await issuer.sign(USER_A))).rejects.toBe(failure);
  });
});
