// FR-AUTH-008 — RequestPasswordResetUseCase + ResetPasswordUseCase.
import { describe, it, expect } from 'vitest';
import { RequestPasswordResetUseCase } from '../RequestPasswordReset';
import { ResetPasswordUseCase } from '../ResetPassword';
import { AuthError } from '../errors';
import { FakeAuthService, makeSession } from './fakeAuthService';

describe('RequestPasswordResetUseCase', () => {
  it('normalizes the email and forwards the redirect target', async () => {
    const auth = new FakeAuthService();
    await new RequestPasswordResetUseCase(auth).execute({
      email: '  User@Example.COM ',
      redirectTo: 'https://app.test/auth/reset-password',
    });

    expect(auth.resetRequestCalls).toEqual([
      { email: 'user@example.com', redirectTo: 'https://app.test/auth/reset-password' },
    ]);
  });

  it('rejects a malformed email before calling the provider', async () => {
    const auth = new FakeAuthService();
    await expect(new RequestPasswordResetUseCase(auth).execute({ email: 'not-an-email' })).rejects.toMatchObject({
      code: 'invalid_email',
    } satisfies Partial<AuthError>);
    expect(auth.resetRequestCalls).toHaveLength(0);
  });

  it('reports success for provider errors that could reveal the account (AC1)', async () => {
    const auth = new FakeAuthService();
    auth.resetRequestError = new AuthError('invalid_credentials', 'user_not_found');

    await expect(new RequestPasswordResetUseCase(auth).execute({ email: 'a@b.co' })).resolves.toBeUndefined();
  });

  it('surfaces rate limiting and network failures', async () => {
    for (const code of ['rate_limited', 'network'] as const) {
      const auth = new FakeAuthService();
      auth.resetRequestError = new AuthError(code, code);
      await expect(new RequestPasswordResetUseCase(auth).execute({ email: 'a@b.co' })).rejects.toMatchObject({ code });
    }
  });
});

describe('ResetPasswordUseCase', () => {
  it('verifies the token, then updates the password and signs out everywhere (AC2/AC3)', async () => {
    const auth = new FakeAuthService();
    auth.verifyEmailResult = makeSession();

    await new ResetPasswordUseCase(auth).execute({ tokenHash: 'tok', newPassword: 'newpass123' });

    expect(auth.recoveryTokens).toEqual(['tok']);
    expect(auth.passwordUpdates).toEqual(['newpass123']);
    expect(auth.resetCallOrder).toEqual(['verifyPasswordRecovery', 'updatePasswordAndSignOutEverywhere']);
  });

  it('falls back to the PKCE code when the link has no token hash', async () => {
    const auth = new FakeAuthService();
    auth.exchangeResult = makeSession();

    await new ResetPasswordUseCase(auth).execute({ code: 'pkce-code', newPassword: 'newpass123' });

    expect(auth.lastExchangeCode).toBe('pkce-code');
    expect(auth.passwordUpdates).toEqual(['newpass123']);
  });

  it('rejects a weak password without consuming the single-use token', async () => {
    const auth = new FakeAuthService();
    auth.verifyEmailResult = makeSession();

    await expect(
      new ResetPasswordUseCase(auth).execute({ tokenHash: 'tok', newPassword: 'short' }),
    ).rejects.toMatchObject({ code: 'weak_password' } satisfies Partial<AuthError>);
    expect(auth.recoveryTokens).toHaveLength(0);
    expect(auth.passwordUpdates).toHaveLength(0);
  });

  it('fails when the link carries neither a token hash nor a code', async () => {
    const auth = new FakeAuthService();
    await expect(new ResetPasswordUseCase(auth).execute({ newPassword: 'newpass123' })).rejects.toMatchObject({
      code: 'authentication_failed',
    } satisfies Partial<AuthError>);
  });

  it('does not change the password when the token is expired or used', async () => {
    const auth = new FakeAuthService();
    auth.recoveryError = new AuthError('session_expired', 'otp_expired');

    await expect(
      new ResetPasswordUseCase(auth).execute({ tokenHash: 'old', newPassword: 'newpass123' }),
    ).rejects.toMatchObject({ code: 'session_expired' });
    expect(auth.passwordUpdates).toHaveLength(0);
  });
});
