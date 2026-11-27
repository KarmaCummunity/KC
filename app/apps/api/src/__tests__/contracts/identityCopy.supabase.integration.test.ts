import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { IDENTITY_PATHS, type SessionResponse } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { decodeJwt } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGoogle, GOOGLE_CLIENT_ID, type TestProvider } from '../../modules/identity/__tests__/providerKeyFixtures';
import { startIdentityApp } from '../support/identityApp';

// The accounts of a real Supabase Auth, carried over to KC's own identity (ADR-013 section 5).
// Members are created and signed in through Supabase Auth's own API, so the password hashes,
// sessions and refresh tokens the copy reads are that service's and not this repository's idea
// of them. Collected only when KC_API_TEST_SUPABASE_URL names a local Supabase stack
// (vitest.config.ts); the backend CI lane provides one.

const SUPABASE_URL = process.env.KC_API_TEST_SUPABASE_URL as string;
const SERVICE_KEY = process.env.KC_API_TEST_SUPABASE_SERVICE_KEY as string;
const ANON_KEY = process.env.KC_API_TEST_SUPABASE_ANON_KEY as string;
const DATABASE_URL = process.env.KC_API_TEST_SUPABASE_DATABASE_URL as string;
const PASSWORD = 'set at supabase 1';

/** What Supabase Auth answers a sign-in or a refresh with. */
interface SupabaseSession {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly user: { readonly id: string };
}

interface CopyCounts {
  source_present: boolean;
  identities: string;
  passwords: string;
  sessions: string;
  refresh_tokens: string;
}

describe('Carrying accounts over from a real Supabase Auth', () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const created: string[] = [];
  let google: TestProvider;
  let app: NestFastifyApplication;

  /** A call to Supabase Auth's own API. */
  const supabaseAuth = async <Body>(path: string, options: { key: string; bearer?: string; method?: string; body?: unknown }): Promise<Body> => {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: options.method ?? 'POST',
      headers: { apikey: options.key, authorization: `Bearer ${options.bearer ?? options.key}`, 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase Auth ${path}: ${response.status} ${text}`);
    return (text === '' ? {} : JSON.parse(text)) as Body;
  };
  /** A member with a verified address and a password, created the way an administrator creates one. */
  const memberAtSupabase = async () => {
    const email = `copy-${randomUUID().slice(0, 12)}@identity.test`;
    const user = await supabaseAuth<{ id: string }>('admin/users', { key: SERVICE_KEY, body: { email, password: PASSWORD, email_confirm: true } });
    created.push(user.id);
    return { email, userId: user.id };
  };
  const signInAtSupabase = (email: string) => supabaseAuth<SupabaseSession>('token?grant_type=password', { key: ANON_KEY, body: { email, password: PASSWORD } });
  const copy = async () => (await pool.query<CopyCounts>('select * from kc_private.auth_copy_from_supabase()')).rows[0] as CopyCounts;
  const post = async (path: string, payload: unknown) => {
    const response = await app.inject({ method: 'POST', url: path, payload: payload as object });
    return { status: response.statusCode, session: response.json<SessionResponse>() };
  };
  const whoIs = async (accessToken: string): Promise<string | number> => {
    const response = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: `Bearer ${accessToken}` } });
    return response.statusCode === 200 ? response.json<{ userId: string }>().userId : response.statusCode;
  };

  beforeAll(async () => {
    google = await createTestGoogle();
    app = await startIdentityApp({ databaseUrl: DATABASE_URL, providerKeys: { google: google.keys }, signIn: { googleClientIds: [GOOGLE_CLIENT_ID], appleClientIds: [] } });
  });

  afterAll(async () => {
    for (const userId of created) await supabaseAuth(`admin/users/${userId}`, { key: SERVICE_KEY, method: 'DELETE' }).catch(() => undefined);
    await app.close();
    await pool.end();
  });

  it('lets a member sign in on KC with the password they set at Supabase, and replaces the carried-over hash', async () => {
    const { email, userId } = await memberAtSupabase();

    const counts = await copy();
    const signedIn = await post(IDENTITY_PATHS.signIn, { email, password: PASSWORD });

    expect(counts.source_present).toBe(true);
    expect(Number(counts.identities)).toBeGreaterThanOrEqual(1);
    expect(Number(counts.passwords)).toBeGreaterThanOrEqual(1);
    expect(signedIn.status).toBe(200);
    expect(signedIn.session.user).toMatchObject({ id: userId, email, emailVerified: true, provider: 'email' });
    expect(await whoIs(signedIn.session.accessToken)).toBe(userId);
    expect((await post(IDENTITY_PATHS.signIn, { email, password: 'not the password 1' })).status).toBe(401);
    const hash = (await pool.query<{ hash: string }>('select hash from kc_private.auth_passwords where user_id = $1', [userId])).rows[0]?.hash;
    expect(hash).toMatch(/^scrypt\$/);
  });

  it('keeps a signed-in member signed in: the refresh token Supabase issued continues the same session on KC', async () => {
    const { email, userId } = await memberAtSupabase();
    const atSupabase = await signInAtSupabase(email);

    await copy();
    const continued = await post(IDENTITY_PATHS.token, { refreshToken: atSupabase.refresh_token });

    expect(continued.status).toBe(200);
    expect(continued.session.user.id).toBe(userId);
    expect(decodeJwt(continued.session.accessToken).sid).toBe(decodeJwt(atSupabase.access_token).session_id);
    expect(await whoIs(continued.session.accessToken)).toBe(userId);
    // From here on the session lives by KC's rules: the token that was carried over worked once.
    expect((await post(IDENTITY_PATHS.token, { refreshToken: continued.session.refreshToken })).status).toBe(200);
  });

  it('carries over neither a session that ended at Supabase nor a refresh token it already replaced', async () => {
    const { email } = await memberAtSupabase();
    const [signedOut, rotated] = [await signInAtSupabase(email), await signInAtSupabase(email)];
    await supabaseAuth('logout?scope=local', { key: ANON_KEY, bearer: signedOut.access_token });
    const successor = await supabaseAuth<SupabaseSession>('token?grant_type=refresh_token', { key: ANON_KEY, body: { refresh_token: rotated.refresh_token } });

    await copy();

    expect((await post(IDENTITY_PATHS.token, { refreshToken: signedOut.refresh_token })).status).toBe(401);
    expect((await post(IDENTITY_PATHS.token, { refreshToken: rotated.refresh_token })).status).toBe(401);
    expect((await post(IDENTITY_PATHS.token, { refreshToken: successor.refresh_token })).status).toBe(200);
  });

  it('adds nothing when it is run again', async () => {
    const { email } = await memberAtSupabase();
    await signInAtSupabase(email);
    await copy();

    const again = await copy();

    expect(again).toEqual({ source_present: true, identities: '0', passwords: '0', sessions: '0', refresh_tokens: '0' });
  });

  it('recognizes a member who signed in with Google at Supabase when they sign in with Google on KC', async () => {
    const { email, userId } = await memberAtSupabase();
    const subject = `google-${randomUUID()}`;
    // The row Supabase Auth keeps for a Google sign-in: the provider's own id of the account under `provider_id`.
    // Written here directly, since no test can sign in at the real Google; its shape is taken from the service's schema.
    await pool.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1, $2, $3::jsonb, 'google', now(), now(), now())`,
      [subject, userId, JSON.stringify({ sub: subject, email, email_verified: true })],
    );

    await copy();
    const signedIn = await post(IDENTITY_PATHS.idToken, { provider: 'google', token: await google.idToken({ sub: subject, email: 'changed-since@identity.test', email_verified: true }) });

    expect(signedIn.status).toBe(200);
    expect(signedIn.session.user.id).toBe(userId);
  });
});
