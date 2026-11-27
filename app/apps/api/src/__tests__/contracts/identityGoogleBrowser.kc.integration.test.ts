import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IDENTITY_PATHS, type SessionResponse } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGoogle, GOOGLE_CLIENT_ID, type TestProvider } from '../../modules/identity/__tests__/providerKeyFixtures';
import { OWN_ISSUER, startIdentityApp } from '../support/identityApp';
import { KcTestDatabase } from '../support/kcDatabase';

const APP_CALLBACK = 'https://app.kc.test/auth/callback';
const CLIENT_SECRET = 'google-client-secret-of-the-test';

/**
 * Google sign-in through a browser redirect on KC's own identity and the KC
 * schema (ADR-013 section 3), through the real routes. Google is a stand-in:
 * it signs ID tokens with a key of its own and "exchanges" the codes this
 * test hands out.
 */
describe('Google browser sign-in of KC\'s own identity, on the KC schema', () => {
  const database = new KcTestDatabase();
  /** What "Google" answers each of its codes with, and what it was asked. */
  const idTokenOfCode = new Map<string, string>();
  const exchanges: Array<Record<string, string>> = [];
  let google: TestProvider;
  let app: NestFastifyApplication;

  const freshEmail = () => `browser-${randomUUID().slice(0, 12)}@identity.test`;
  /** The secret an app instance keeps for one sign-in, and the challenge it sends for it. */
  const appSecret = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };
  const get = async (path: string, query: Record<string, string>) => {
    const response = await app.inject({ method: 'GET', url: `${path}?${new URLSearchParams(query).toString()}` });
    return { status: response.statusCode, location: response.headers.location ? new URL(String(response.headers.location)) : null };
  };
  const redeem = async (code: unknown, codeVerifier: unknown) => {
    const response = await app.inject({ method: 'POST', url: IDENTITY_PATHS.code, payload: { code, codeVerifier } });
    const body = response.json<Record<string, unknown>>();
    return { status: response.statusCode, session: body as unknown as SessionResponse, error: (body.error as { code?: string } | undefined)?.code };
  };
  /** Step 1: the app sends the browser off; the answer is Google's address for this sign-in. */
  const start = (challenge: string, redirectTo = APP_CALLBACK) => get(IDENTITY_PATHS.googleAuthorize, { redirect_to: redirectTo, code_challenge: challenge });
  /**
   * Step 2 as Google and the browser do it: the member signs in at "Google",
   * which issues an ID token carrying the nonce of this sign-in, and the
   * browser arrives at the callback with Google's code and the state.
   */
  const comeBackFromGoogle = async (atGoogle: URL, claims: Record<string, unknown>, nonce = atGoogle.searchParams.get('nonce')) => {
    const googleCode = `google-code-${randomUUID()}`;
    idTokenOfCode.set(googleCode, await google.idToken({ email_verified: true, nonce, ...claims }));
    return get(`${OWN_ISSUER.replace('https://api.kc.test', '')}/google/callback`, { code: googleCode, state: atGoogle.searchParams.get('state') as string });
  };

  beforeAll(async () => {
    google = await createTestGoogle();
    app = await startIdentityApp({
      providerKeys: { google: google.keys },
      signIn: { googleClientIds: [GOOGLE_CLIENT_ID], googleBrowserClient: { clientId: GOOGLE_CLIENT_ID, clientSecret: CLIENT_SECRET } },
      authRedirectUrls: [APP_CALLBACK],
      googleCodeExchange: (form) => {
        exchanges.push(Object.fromEntries(form));
        return Promise.resolve(idTokenOfCode.get(form.get('code') ?? '') ?? null);
      },
    });
  });

  afterAll(async () => {
    await database.admin.query("delete from auth.users where email like 'browser-%@identity.test'");
    await app.close();
    await database.close();
  });

  it('signs a member in: to Google and back, then a code only the app that started it can exchange, once', async () => {
    const email = freshEmail();
    const { verifier, challenge } = appSecret();

    const toGoogle = await start(challenge);
    const backAtApp = await comeBackFromGoogle(toGoogle.location as URL, { sub: `g-${email}`, email, name: 'Noa Bar' });
    const code = backAtApp.location?.searchParams.get('code');
    const signedIn = await redeem(code, verifier);

    expect(toGoogle.status).toBe(302);
    expect(`${toGoogle.location?.origin}${toGoogle.location?.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(toGoogle.location?.searchParams ?? [])).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${OWN_ISSUER}/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
    });
    expect(backAtApp.status).toBe(302);
    expect(`${backAtApp.location?.origin}${backAtApp.location?.pathname}`).toBe(APP_CALLBACK);
    // Google's code was exchanged by the server, with the secret only the server holds.
    expect(exchanges.at(-1)).toMatchObject({ client_id: GOOGLE_CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: `${OWN_ISSUER}/google/callback`, grant_type: 'authorization_code' });
    expect(signedIn.status).toBe(200);
    expect(signedIn.session.user).toMatchObject({ email, provider: 'google', displayName: 'Noa Bar' });
    expect([(await redeem(code, verifier)).status, (await redeem(code, verifier)).error]).toEqual([401, 'invalid_code']);
  });

  it('gives the code to nobody without the app\'s secret, and leaves it usable for the app', async () => {
    const email = freshEmail();
    const { verifier, challenge } = appSecret();
    const toGoogle = await start(challenge);
    const code = (await comeBackFromGoogle(toGoogle.location as URL, { sub: `g-${email}`, email })).location?.searchParams.get('code');

    const stolen = await redeem(code, appSecret().verifier);

    expect([stolen.status, stolen.error]).toEqual([401, 'invalid_code']);
    expect((await redeem(code, verifier)).status).toBe(200);
  });

  it('sends the browser back with an error, and signs nobody in, when the member backs out or Google refuses', async () => {
    const email = freshEmail();
    const toGoogle = (await start(appSecret().challenge)).location as URL;
    const state = toGoogle.searchParams.get('state') as string;
    const callback = `${OWN_ISSUER.replace('https://api.kc.test', '')}/google/callback`;

    const backedOut = await get(callback, { error: 'access_denied', state });
    const refusedCode = await get(callback, { code: 'a-code-google-never-issued', state });
    // An ID token of another sign-in (another nonce), replayed into this one.
    const replayed = await comeBackFromGoogle(toGoogle, { sub: `g-${email}`, email }, 'nonce-of-another-sign-in');
    const unvouched = await comeBackFromGoogle(toGoogle, { sub: `g-${email}`, email, email_verified: false });

    expect([backedOut, refusedCode, replayed, unvouched].map((answer) => [answer.status, `${answer.location?.origin}${answer.location?.pathname}`, answer.location?.searchParams.get('error'), answer.location?.searchParams.get('code')])).toEqual([
      [302, APP_CALLBACK, 'access_denied', null],
      [302, APP_CALLBACK, 'sign_in_failed', null],
      [302, APP_CALLBACK, 'sign_in_failed', null],
      [302, APP_CALLBACK, 'email_not_verified', null],
    ]);
    expect((await database.admin.query('select 1 from auth.users where email = $1', [email])).rowCount).toBe(0);
  });

  it('redirects nowhere for a state it did not make, and starts no sign-in towards an address it does not allow', async () => {
    const callback = `${OWN_ISSUER.replace('https://api.kc.test', '')}/google/callback`;
    const { challenge } = appSecret();
    const state = ((await start(challenge)).location as URL).searchParams.get('state') as string;
    // The same state with its destination changed: the signature no longer covers it.
    const [header, payload, signature] = state.split('.') as [string, string, string];
    const changed = Buffer.from(JSON.stringify({ ...(JSON.parse(Buffer.from(payload, 'base64url').toString()) as object), r: 'https://elsewhere.test/steal' })).toString('base64url');

    const answers = [
      await get(callback, { code: 'x', state: 'not-a-state' }),
      await get(callback, { code: 'x', state: `${header}.${changed}.${signature}` }),
      await get(callback, { code: 'x' }),
      await start(challenge, 'https://elsewhere.test/auth/callback'),
      await start('too-short'),
    ];

    expect(answers.map((answer) => [answer.status, answer.location])).toEqual([[400, null], [400, null], [400, null], [400, null], [400, null]]);
  });

  it('lets a sign-in code lapse after five minutes, and refuses a request that is not an exchange', async () => {
    const email = freshEmail();
    const { verifier, challenge } = appSecret();
    const code = (await comeBackFromGoogle((await start(challenge)).location as URL, { sub: `g-${email}`, email })).location?.searchParams.get('code');
    await database.admin.query(
      "update kc_private.auth_one_time_tokens set created_at = created_at - interval '5 minutes 1 second', expires_at = expires_at - interval '5 minutes 1 second' where user_id = kc_private.auth_user_id_by_email($1)",
      [email],
    );

    expect((await redeem(code, verifier)).error).toBe('invalid_code');
    expect((await redeem(code, 'short')).status).toBe(400);
    expect((await redeem(undefined, verifier)).status).toBe(400);
  });

  it('answers 503 on a server that is not registered at Google for the browser', async () => {
    const unregistered = await startIdentityApp({ authRedirectUrls: [APP_CALLBACK] });

    try {
      const response = await unregistered.inject({ method: 'GET', url: `${IDENTITY_PATHS.googleAuthorize}?${new URLSearchParams({ redirect_to: APP_CALLBACK, code_challenge: appSecret().challenge }).toString()}` });
      expect(response.statusCode).toBe(503);
    } finally {
      await unregistered.close();
    }
  });
});
