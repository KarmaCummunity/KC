import { describe, expect, it } from 'vitest';
import { SignInWithGoogleUseCase } from '../SignInWithGoogle';
import { AuthError } from '../errors';
import { FakeAuthService, makeSession } from './fakeAuthService';

const REDIRECT = 'karmacommunity://auth/callback';

describe('SignInWithGoogleUseCase', () => {
  it('exchanges the OAuth code from the redirect URL for a session', async () => {
    const auth = new FakeAuthService();
    auth.exchangeResult = makeSession();
    const opener = async (_url: string, _redirect: string) =>
      `${REDIRECT}?code=abc123&state=xyz`;

    const uc = new SignInWithGoogleUseCase(auth, opener);
    const out = await uc.execute({ redirectTo: REDIRECT });

    expect(out.session).toBe(auth.exchangeResult);
    expect(auth.lastExchangeCode).toBe('abc123');
  });

  it('correctly extracts code when URL contains a hash fragment', async () => {
    const auth = new FakeAuthService();
    auth.exchangeResult = makeSession();
    const opener = async () => `${REDIRECT}?code=hash_code&state=xyz#access_token=none`;

    const uc = new SignInWithGoogleUseCase(auth, opener);
    const out = await uc.execute({ redirectTo: REDIRECT });

    expect(out.session).toBe(auth.exchangeResult);
    expect(auth.lastExchangeCode).toBe('hash_code');
  });

  it('throws oauth_dismissed if the browser was closed without a redirect', async () => {
    const auth = new FakeAuthService();
    const opener = async () => null;
    const uc = new SignInWithGoogleUseCase(auth, opener);

    await expect(uc.execute({ redirectTo: REDIRECT })).rejects.toMatchObject({
      message: 'oauth_dismissed',
    });
  });

  it('throws oauth_no_code if the redirect URL has no code param', async () => {
    const auth = new FakeAuthService();
    const opener = async () => `${REDIRECT}?error=denied`;
    const uc = new SignInWithGoogleUseCase(auth, opener);

    await expect(uc.execute({ redirectTo: REDIRECT })).rejects.toBeInstanceOf(AuthError);
  });
});
