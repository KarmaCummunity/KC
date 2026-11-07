import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@kc/application';
import { SupabaseAuthService } from '../SupabaseAuthService';

/* eslint-disable @typescript-eslint/no-explicit-any */

// {{ENG:native-google-sign-in}}: the native Google picker's ID token is exchanged
// via supabase.auth.signInWithIdToken({ provider: 'google' }).

function makeClient(
  idTokenResult: { data: any; error: any },
  capture?: (args: any) => void,
): SupabaseClient<any> {
  return {
    auth: {
      signInWithIdToken: async (args: any) => {
        capture?.(args);
        return idTokenResult;
      },
    },
  } as unknown as SupabaseClient<any>;
}

function sbSession(): any {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 1_750_000_000,
    user: { id: 'u_g', email: 'user@gmail.com', email_confirmed_at: '2026-11-01T00:00:00.000Z', user_metadata: {} },
  };
}

describe('SupabaseAuthService — signInWithGoogleIdToken', () => {
  it('exchanges the Google ID token for a mapped session', async () => {
    let captured: any;
    const client = makeClient({ data: { session: sbSession() }, error: null }, (a) => (captured = a));

    const out = await new SupabaseAuthService(client).signInWithGoogleIdToken('gtok');

    expect(out.userId).toBe('u_g');
    expect(captured).toEqual({ provider: 'google', token: 'gtok' });
  });

  it('throws AuthError("unknown") when no session is returned', async () => {
    const client = makeClient({ data: { session: null }, error: null });
    await expect(new SupabaseAuthService(client).signInWithGoogleIdToken('t')).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('throws via mapAuthError when Supabase rejects the token', async () => {
    const client = makeClient({ data: null, error: { message: 'invalid_token' } });
    await expect(new SupabaseAuthService(client).signInWithGoogleIdToken('t')).rejects.toBeInstanceOf(AuthError);
  });
});
