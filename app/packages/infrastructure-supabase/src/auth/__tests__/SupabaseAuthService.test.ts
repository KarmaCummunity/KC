import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@kc/application';
import { SupabaseAuthService } from '../SupabaseAuthService';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Companion file SupabaseAuthService.oauth.test.ts covers the OAuth +
// exchange + verify paths (kept separate so each file stays under cap).

interface AuthFakeOpts {
  signUpResult?: { data: any; error: any };
  signInResult?: { data: any; error: any };
  signOutError?: any;
  getSessionResult?: { data: any; error: any };
}

function makeAuthClient(opts: AuthFakeOpts): SupabaseClient<any> {
  return {
    auth: {
      signUp: async () => opts.signUpResult ?? { data: { session: null }, error: null },
      signInWithPassword: async () => opts.signInResult ?? { data: { session: null }, error: null },
      signOut: async () => ({ error: opts.signOutError ?? null }),
      getSession: async () => opts.getSessionResult ?? { data: { session: null }, error: null },
    },
  } as unknown as SupabaseClient<any>;
}

function sbSession(over: any = {}): any {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 1_750_000_000,
    user: {
      id: 'u_1', email: 'a@b.test', email_confirmed_at: '2026-05-16T12:00:00.000Z', created_at: '2026-05-16T11:59:00.000Z',
      user_metadata: { full_name: 'Alice', avatar_url: 'a.jpg' },
    },
    ...over,
  };
}

describe('SupabaseAuthService — signUpWithEmail', () => {
  it('returns the mapped session on successful sign-up that already creates a session', async () => {
    const client = makeAuthClient({ signUpResult: { data: { session: sbSession() }, error: null } });
    const out = await new SupabaseAuthService(client).signUpWithEmail('a@b.test', 'pw');
    expect(out).toMatchObject({ userId: 'u_1', email: 'a@b.test', displayName: 'Alice', emailVerified: true });
  });

  it('maps the auth account creation time for the time-to-first-post metric (#1042)', async () => {
    const client = makeAuthClient({ signUpResult: { data: { session: sbSession() }, error: null } });
    const out = await new SupabaseAuthService(client).signUpWithEmail('a@b.test', 'pw');
    expect(out?.accountCreatedAt).toBe('2026-05-16T11:59:00.000Z');
  });

  it('returns null when the sign-up succeeds without a session (email-verification flow)', async () => {
    const client = makeAuthClient({ signUpResult: { data: { session: null }, error: null } });
    expect(await new SupabaseAuthService(client).signUpWithEmail('a@b.test', 'pw')).toBeNull();
  });

  it('TD-69: collapses email_already_in_use → null (do not reveal account existence)', async () => {
    // mapAuthError routes Supabase's "User already registered" message to
    // 'email_already_in_use'. The service must NOT throw — it returns null
    // so the UI falls through to the "check your email" panel.
    const client = makeAuthClient({
      signUpResult: { data: null, error: { message: 'User already registered' } },
    });
    expect(await new SupabaseAuthService(client).signUpWithEmail('a@b.test', 'pw')).toBeNull();
  });

  it('throws non-collapsible errors via mapAuthError', async () => {
    const client = makeAuthClient({
      signUpResult: { data: null, error: { message: 'weak_password: foo' } },
    });
    await expect(new SupabaseAuthService(client).signUpWithEmail('a@b.test', 'pw')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('SupabaseAuthService — signInWithEmail', () => {
  it('returns the mapped session on success', async () => {
    const client = makeAuthClient({ signInResult: { data: { session: sbSession() }, error: null } });
    const out = await new SupabaseAuthService(client).signInWithEmail('a@b.test', 'pw');
    expect(out.userId).toBe('u_1');
  });

  it('TD-69: invalid_credentials collapses to AuthError("authentication_failed")', async () => {
    const client = makeAuthClient({
      signInResult: { data: null, error: { message: 'Invalid login credentials' } },
    });
    await expect(new SupabaseAuthService(client).signInWithEmail('a@b.test', 'pw')).rejects.toMatchObject({
      name: 'AuthError', code: 'authentication_failed',
    });
  });

  it('TD-69: email_already_in_use also collapses to authentication_failed', async () => {
    // Same enumeration-prevention rule applied symmetrically to sign-in.
    const client = makeAuthClient({
      signInResult: { data: null, error: { message: 'User already registered' } },
    });
    await expect(new SupabaseAuthService(client).signInWithEmail('a@b.test', 'pw')).rejects.toMatchObject({
      code: 'authentication_failed',
    });
  });

  it('throws AuthError("unknown") when sign-in succeeds with no session', async () => {
    const client = makeAuthClient({ signInResult: { data: { session: null }, error: null } });
    await expect(new SupabaseAuthService(client).signInWithEmail('a@b.test', 'pw')).rejects.toMatchObject({
      code: 'unknown',
    });
  });
});

describe('SupabaseAuthService — signOut / getCurrentSession', () => {
  it('signOut resolves on success', async () => {
    expect(await new SupabaseAuthService(makeAuthClient({})).signOut()).toBeUndefined();
  });

  it('signOut throws via mapAuthError', async () => {
    const client = makeAuthClient({ signOutError: { message: 'transport' } });
    await expect(new SupabaseAuthService(client).signOut()).rejects.toBeInstanceOf(AuthError);
  });

  it('getCurrentSession returns null when there is no active session', async () => {
    const client = makeAuthClient({ getSessionResult: { data: { session: null }, error: null } });
    expect(await new SupabaseAuthService(client).getCurrentSession()).toBeNull();
  });

  it('getCurrentSession maps the active session', async () => {
    const client = makeAuthClient({ getSessionResult: { data: { session: sbSession() }, error: null } });
    const out = await new SupabaseAuthService(client).getCurrentSession();
    expect(out?.userId).toBe('u_1');
  });

  it('getCurrentSession throws via mapAuthError', async () => {
    const client = makeAuthClient({ getSessionResult: { data: null, error: { message: 'transport' } } });
    await expect(new SupabaseAuthService(client).getCurrentSession()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('SupabaseAuthService — toSession mapping defaults', () => {
  it('falls back to name when full_name is absent, picture when avatar_url is absent', async () => {
    // pickString iteration order: ['full_name', 'name'] / ['avatar_url', 'picture'].
    const client = makeAuthClient({
      getSessionResult: {
        data: {
          session: sbSession({
            user: {
              id: 'u_2',
              email: null,
              email_confirmed_at: null,
              user_metadata: { name: 'Bob', picture: 'b.jpg' },
            },
          }),
        },
        error: null,
      },
    });
    const out = await new SupabaseAuthService(client).getCurrentSession();
    expect(out).toMatchObject({
      userId: 'u_2',
      email: null,
      emailVerified: false,
      displayName: 'Bob',
      avatarUrl: 'b.jpg',
    });
  });

  it('returns null for displayName / avatarUrl when no metadata key matches', async () => {
    const client = makeAuthClient({
      getSessionResult: {
        data: {
          session: sbSession({ user: { id: 'u_3', email: null, email_confirmed_at: null, user_metadata: {} } }),
        },
        error: null,
      },
    });
    const out = await new SupabaseAuthService(client).getCurrentSession();
    expect(out?.displayName).toBeNull();
    expect(out?.avatarUrl).toBeNull();
    expect(out?.accountCreatedAt).toBeNull();
  });

  it('computes a fallback expiresAt when expires_at is missing (Date.now()/1000 + expires_in)', async () => {
    const client = makeAuthClient({
      getSessionResult: {
        data: {
          session: { ...sbSession(), expires_at: undefined, expires_in: 7200 },
        },
        error: null,
      },
    });
    const before = Math.floor(Date.now() / 1000);
    const out = await new SupabaseAuthService(client).getCurrentSession();
    expect(out!.expiresAt).toBeGreaterThanOrEqual(before + 7200 - 5);
    expect(out!.expiresAt).toBeLessThanOrEqual(before + 7200 + 5);
  });
});
