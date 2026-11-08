import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@kc/application';
import { SupabaseAuthService } from '../SupabaseAuthService';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FR-AUTH-003 (#1955): native Google sign-in exchanges the ID token via
// supabase.auth.signInWithIdToken({ provider: 'google' }).

function makeClient(idTokenResult: { data: any; error: any }, capture?: (args: any) => void): SupabaseClient<any> {
  return {
    auth: {
      signInWithIdToken: async (args: any) => {
        capture?.(args);
        return idTokenResult;
      },
    },
  } as unknown as SupabaseClient<any>;
}

const sbSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: 1_750_000_000,
  user: { id: 'u_1', email: 'a@gmail.com', email_confirmed_at: '2026-06-01T00:00:00.000Z', user_metadata: {} },
};

describe('SupabaseAuthService — signInWithGoogleIdToken', () => {
  it('exchanges the Google ID token for a mapped session', async () => {
    let captured: any;
    const client = makeClient({ data: { session: sbSession }, error: null }, (a) => (captured = a));

    const out = await new SupabaseAuthService(client).signInWithGoogleIdToken('google.id.token');

    expect(out.userId).toBe('u_1');
    expect(captured).toEqual({ provider: 'google', token: 'google.id.token' });
  });

  it('throws AuthError("unknown") when no session is returned', async () => {
    const client = makeClient({ data: { session: null }, error: null });
    await expect(new SupabaseAuthService(client).signInWithGoogleIdToken('t')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('throws via mapAuthError when Supabase rejects the token', async () => {
    const client = makeClient({ data: null, error: { message: 'invalid_token' } });
    await expect(new SupabaseAuthService(client).signInWithGoogleIdToken('t')).rejects.toBeInstanceOf(AuthError);
  });
});
