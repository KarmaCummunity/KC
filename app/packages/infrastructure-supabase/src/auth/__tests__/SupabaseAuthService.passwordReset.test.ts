import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthService } from '../SupabaseAuthService';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FR-AUTH-008 — password reset adapter methods.

function sbSession(): any {
  return {
    access_token: 'a',
    refresh_token: 'r',
    expires_at: 9_999_999_999,
    user: { id: 'u_1', email: 'u@test.local', app_metadata: { provider: 'email' }, user_metadata: {} },
  };
}

function makeClient(over: Partial<Record<string, any>> = {}) {
  const auth = {
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { session: sbSession() }, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...over,
  };
  return { client: { auth } as unknown as SupabaseClient<any>, auth };
}

describe('SupabaseAuthService password reset', () => {
  it('requests the reset email with the redirect target', async () => {
    const { client, auth } = makeClient();
    await new SupabaseAuthService(client).requestPasswordReset('u@test.local', { redirectTo: 'https://x/auth/reset-password' });

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('u@test.local', { redirectTo: 'https://x/auth/reset-password' });
  });

  it('maps a rate-limit error from the reset request', async () => {
    const { client } = makeClient({
      resetPasswordForEmail: vi.fn(async () => ({ data: null, error: { message: 'email rate limit exceeded', status: 429 } })),
    });
    await expect(new SupabaseAuthService(client).requestPasswordReset('u@test.local')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('verifies the recovery token with type=recovery and returns a session', async () => {
    const { client, auth } = makeClient();
    const session = await new SupabaseAuthService(client).verifyPasswordRecovery('tok');

    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'tok' });
    expect(session.userId).toBe('u_1');
  });

  it('updates the password, then signs out with global scope', async () => {
    const { client, auth } = makeClient();
    await new SupabaseAuthService(client).updatePasswordAndSignOutEverywhere('newpass123');

    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(auth.updateUser.mock.invocationCallOrder[0]!).toBeLessThan(auth.signOut.mock.invocationCallOrder[0]!);
  });

  it('does not sign out when the password update fails', async () => {
    const { client, auth } = makeClient({
      updateUser: vi.fn(async () => ({ data: null, error: { message: 'Password should be at least 8 characters', status: 422 } })),
    });
    await expect(new SupabaseAuthService(client).updatePasswordAndSignOutEverywhere('x')).rejects.toBeDefined();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
