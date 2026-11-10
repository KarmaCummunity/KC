import { describe, expect, it, vi } from 'vitest';
import { SignInWithGoogleNativeUseCase, type RequestGoogleIdToken } from '../SignInWithGoogleNative';
import { SignInWithGoogleUseCase } from '../SignInWithGoogle';
import { FakeAuthService, makeSession } from './fakeAuthService';

const REDIRECT = 'karmacommunity://auth/callback';

function setup(request: RequestGoogleIdToken) {
  const auth = new FakeAuthService();
  const opener = vi.fn(async () => `${REDIRECT}?code=browser_code`);
  const browserFlow = new SignInWithGoogleUseCase(auth, opener);
  const uc = new SignInWithGoogleNativeUseCase(auth, request, browserFlow);
  return { auth, opener, uc };
}

describe('SignInWithGoogleNativeUseCase (FR-AUTH-003, #1955)', () => {
  it('exchanges the native Google ID token for a session without opening the browser', async () => {
    const { auth, opener, uc } = setup(async () => ({ kind: 'token', idToken: 'id.token.jwt' }));
    auth.googleIdTokenResult = makeSession();

    const out = await uc.execute({ redirectTo: REDIRECT });

    expect(out.session).toBe(auth.googleIdTokenResult);
    expect(auth.lastGoogleIdToken).toBe('id.token.jwt');
    expect(opener).not.toHaveBeenCalled();
  });

  it('reports a cancelled account sheet as oauth_dismissed (AC4: no state change)', async () => {
    const { auth, opener, uc } = setup(async () => ({ kind: 'cancelled' }));

    await expect(uc.execute({ redirectTo: REDIRECT })).rejects.toMatchObject({ message: 'oauth_dismissed' });
    expect(auth.lastGoogleIdToken).toBeNull();
    expect(opener).not.toHaveBeenCalled();
  });

  it('falls back to the browser flow when native sign-in is unavailable', async () => {
    const { auth, opener, uc } = setup(async () => ({ kind: 'unavailable' }));
    auth.exchangeResult = makeSession();

    const out = await uc.execute({ redirectTo: REDIRECT });

    expect(out.session).toBe(auth.exchangeResult);
    expect(opener).toHaveBeenCalledOnce();
    expect(auth.lastExchangeCode).toBe('browser_code');
    expect(auth.lastGoogleIdToken).toBeNull();
  });

  it('propagates a Supabase rejection of the ID token', async () => {
    const { auth, uc } = setup(async () => ({ kind: 'token', idToken: 'bad' }));
    auth.googleIdTokenError = new Error('invalid audience');

    await expect(uc.execute({ redirectTo: REDIRECT })).rejects.toThrow('invalid audience');
  });
});
