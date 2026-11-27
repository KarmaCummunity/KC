import { beforeAll, describe, expect, it } from 'vitest';
import { createAppleTokenVerifier, createGoogleTokenVerifier, InvalidProviderTokenError, type ProviderTokenVerifier } from '../providerTokens';
import { APPLE_CLIENT_ID, appleNonceClaim, createTestApple, createTestGoogle, GOOGLE_CLIENT_ID, type TestProvider } from './providerKeyFixtures';

const GOOGLE_MEMBER = { sub: 'google-subject-1', email: 'dana@example.test', email_verified: true, name: 'Dana Levi', picture: 'https://photos.example.test/dana.jpg' };

describe('Google ID tokens', () => {
  let google: TestProvider;
  let verifier: ProviderTokenVerifier;

  beforeAll(async () => {
    google = await createTestGoogle();
    verifier = createGoogleTokenVerifier(google.keys, [GOOGLE_CLIENT_ID, 'kc-ios.apps.googleusercontent.test']);
  });

  it('reads who the member is from a token Google signed for one of KC\'s client ids', async () => {
    expect(await verifier.verify(await google.idToken(GOOGLE_MEMBER))).toEqual({
      provider: 'google',
      subject: 'google-subject-1',
      email: 'dana@example.test',
      emailVerified: true,
      displayName: 'Dana Levi',
      avatarUrl: 'https://photos.example.test/dana.jpg',
    });
    await expect(verifier.verify(await google.idToken({ ...GOOGLE_MEMBER, aud: 'kc-ios.apps.googleusercontent.test', iss: 'accounts.google.com' }))).resolves.toMatchObject({ subject: 'google-subject-1' });
  });

  it('requires the nonce of a sign-in that made one, and none of a sign-in that did not', async () => {
    const bound = await google.idToken({ ...GOOGLE_MEMBER, nonce: 'made-for-this-sign-in' });

    await expect(verifier.verify(bound, 'made-for-this-sign-in')).resolves.toMatchObject({ subject: 'google-subject-1' });
    await expect(verifier.verify(bound, 'made-for-another')).rejects.toBeInstanceOf(InvalidProviderTokenError);
    await expect(verifier.verify(await google.idToken(GOOGLE_MEMBER), 'made-for-this-sign-in')).rejects.toBeInstanceOf(InvalidProviderTokenError);
    // The native sheet binds no nonce: a token is then judged without one.
    await expect(verifier.verify(bound)).resolves.toMatchObject({ subject: 'google-subject-1' });
  });

  it('does not take an address for verified unless Google says so', async () => {
    expect(await verifier.verify(await google.idToken({ sub: 's', email: 'x@example.test' }))).toMatchObject({ email: 'x@example.test', emailVerified: false, displayName: null });
    expect(await verifier.verify(await google.idToken({ sub: 's', email: 'x@example.test', email_verified: 'yes' }))).toMatchObject({ emailVerified: false });
  });

  it.each([
    ['issued for another app', () => ({ claims: { ...GOOGLE_MEMBER, aud: 'someone-else.apps.googleusercontent.test' } })],
    ['of another issuer', () => ({ claims: { ...GOOGLE_MEMBER, iss: 'https://accounts.elsewhere.test' } })],
    ['that expired', () => ({ claims: GOOGLE_MEMBER, options: { expiresInSeconds: -60 } })],
    ['signed with a key Google never published', () => ({ claims: GOOGLE_MEMBER, options: { foreignKey: true } })],
    ['that names nobody', () => ({ claims: { ...GOOGLE_MEMBER, sub: undefined } })],
  ])('refuses a token %s', async (_what, make) => {
    const { claims, options } = make() as { claims: Record<string, unknown>; options?: { expiresInSeconds?: number; foreignKey?: boolean } };

    await expect(verifier.verify(await google.idToken(claims, options))).rejects.toBeInstanceOf(InvalidProviderTokenError);
  });

  it('refuses text that is not a token, and every token while no client id is configured', async () => {
    await expect(verifier.verify('not.a.token')).rejects.toBeInstanceOf(InvalidProviderTokenError);
    await expect(createGoogleTokenVerifier(google.keys, []).verify(await google.idToken(GOOGLE_MEMBER))).rejects.toBeInstanceOf(InvalidProviderTokenError);
  });

  it('lets a failure to reach Google\'s keys surface as a fault, never as "this token is bad"', async () => {
    const unreachable = createGoogleTokenVerifier(() => Promise.reject(new Error('keys unreachable')), [GOOGLE_CLIENT_ID]);

    const failure = await unreachable.verify(await google.idToken(GOOGLE_MEMBER)).catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(InvalidProviderTokenError);
    expect((failure as Error).message).toBe('keys unreachable');
  });
});

describe('Apple ID tokens', () => {
  let apple: TestProvider;
  let verifier: ProviderTokenVerifier;
  const RAW_NONCE = 'a-random-value-the-app-made';
  const member = (overrides: Record<string, unknown> = {}) => ({ sub: 'apple-subject-1', email: 'relay123@privaterelay.appleid.test', email_verified: 'true', nonce: appleNonceClaim(RAW_NONCE), ...overrides });

  beforeAll(async () => {
    apple = await createTestApple();
    verifier = createAppleTokenVerifier(apple.keys, [APPLE_CLIENT_ID]);
  });

  it('reads the member from a token bound to the nonce the app made; Apple gives no name', async () => {
    expect(await verifier.verify(await apple.idToken(member()), RAW_NONCE)).toEqual({
      provider: 'apple',
      subject: 'apple-subject-1',
      email: 'relay123@privaterelay.appleid.test',
      emailVerified: true,
      displayName: null,
      avatarUrl: null,
    });
  });

  it('refuses a token presented without its nonce, with another nonce, or issued without one', async () => {
    const token = await apple.idToken(member());

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidProviderTokenError);
    await expect(verifier.verify(token, 'another-value')).rejects.toBeInstanceOf(InvalidProviderTokenError);
    // The hash itself is not the nonce: only the app that made the value can present it.
    await expect(verifier.verify(token, appleNonceClaim(RAW_NONCE))).rejects.toBeInstanceOf(InvalidProviderTokenError);
    await expect(verifier.verify(await apple.idToken(member({ nonce: undefined })), RAW_NONCE)).rejects.toBeInstanceOf(InvalidProviderTokenError);
  });

  it('refuses a token issued for another app', async () => {
    await expect(verifier.verify(await apple.idToken(member({ aud: 'com.someone.else' })), RAW_NONCE)).rejects.toBeInstanceOf(InvalidProviderTokenError);
  });
});
