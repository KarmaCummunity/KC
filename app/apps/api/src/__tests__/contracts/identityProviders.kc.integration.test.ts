import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { IDENTITY_PATHS, type SessionResponse } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdentityEmail } from '../../modules/identity/emailSender';
import { APPLE_CLIENT_ID, appleNonceClaim, createTestApple, createTestGoogle, GOOGLE_CLIENT_ID, type TestProvider } from '../../modules/identity/__tests__/providerKeyFixtures';
import { BackgroundWork } from '../../platform/background/backgroundWork';
import { startIdentityApp } from '../support/identityApp';
import { KcTestDatabase } from '../support/kcDatabase';

const VERIFY_URL = 'https://app.kc.test/auth/verify';
const PASSWORD = 'correct horse 9';

/**
 * Sign-in through Google and Apple on KC's own identity and the KC schema
 * (ADR-013 section 3), through the real route. The providers are stand-ins
 * that sign ID tokens with keys of their own, as the real ones do.
 */
describe('Provider sign-in of KC\'s own identity, on the KC schema', () => {
  const database = new KcTestDatabase();
  const sent: IdentityEmail[] = [];
  let google: TestProvider;
  let apple: TestProvider;
  let app: NestFastifyApplication;

  const freshEmail = () => `provider-${randomUUID().slice(0, 12)}@identity.test`;
  const post = async (path: string, payload: unknown) => {
    const response = await app.inject({ method: 'POST', url: path, payload: payload as object });
    await app.get(BackgroundWork).idle();
    const body = response.json<Record<string, unknown>>();
    return { status: response.statusCode, session: body as unknown as SessionResponse, error: (body.error as { code?: string } | undefined)?.code };
  };
  /** A sign-in with the ID token "Google" issues for these claims. */
  const withGoogle = async (claims: Record<string, unknown>) => post(IDENTITY_PATHS.idToken, { provider: 'google', token: await google.idToken({ email_verified: true, ...claims }) });
  const memberOf = async (userId: string) =>
    (
      await database.admin.query<{ display_name: string; avatar_url: string | null; status: string }>(
        'select u.display_name, u.avatar_url, a.status::text from public.users u join public.user_account a on a.user_id = u.id where u.id = $1',
        [userId],
      )
    ).rows[0];
  const membersWith = async (email: string) => (await database.admin.query('select 1 from auth.users where email = $1', [email])).rowCount;

  beforeAll(async () => {
    [google, apple] = [await createTestGoogle(), await createTestApple()];
    app = await startIdentityApp({
      providerKeys: { google: google.keys, apple: apple.keys },
      signIn: { googleClientIds: [GOOGLE_CLIENT_ID], appleClientIds: [APPLE_CLIENT_ID] },
      emailSender: { send: (message) => (sent.push(message), Promise.resolve()) },
      authRedirectUrls: [VERIFY_URL],
    });
  });

  afterAll(async () => {
    await database.admin.query("delete from auth.users where email like 'provider-%@identity.test'");
    await app.close();
    await database.close();
  });

  it('creates an active member at the first Google sign-in, with the name and picture Google gave', async () => {
    const email = freshEmail();

    const first = await withGoogle({ sub: `g-${email}`, email, name: 'Dana Levi', picture: 'https://photos.example.test/dana.jpg' });

    expect(first.status).toBe(200);
    expect(first.session.user).toMatchObject({ email, emailVerified: true, provider: 'google', displayName: 'Dana Levi', avatarUrl: 'https://photos.example.test/dana.jpg' });
    expect(await memberOf(first.session.user.id)).toEqual({ display_name: 'Dana Levi', avatar_url: 'https://photos.example.test/dana.jpg', status: 'active' });
  });

  it('recognizes a provider account by the provider\'s id of it: the same member after their address there changed', async () => {
    const email = freshEmail();
    const first = await withGoogle({ sub: `g-${email}`, email });

    const later = await withGoogle({ sub: `g-${email}`, email: freshEmail() });

    expect(later.session.user.id).toBe(first.session.user.id);
    // The member's address here is theirs to change here; a sign-in does not rewrite it.
    expect(later.session.user.email).toBe(email);
    expect(await membersWith(email)).toBe(1);
  });

  it('signs a member in with Apple only when the token is bound to the nonce the app presents', async () => {
    const email = freshEmail();
    const token = await apple.idToken({ sub: `a-${email}`, email, email_verified: 'true', nonce: appleNonceClaim('made-by-the-app') });

    const signedIn = await post(IDENTITY_PATHS.idToken, { provider: 'apple', token, nonce: 'made-by-the-app' });
    const withoutNonce = await post(IDENTITY_PATHS.idToken, { provider: 'apple', token });
    const asGoogle = await post(IDENTITY_PATHS.idToken, { provider: 'google', token });

    expect(signedIn.status).toBe(200);
    expect(signedIn.session.user).toMatchObject({ email, provider: 'apple' });
    expect((await memberOf(signedIn.session.user.id))?.status).toBe('active');
    expect([withoutNonce.status, withoutNonce.error]).toEqual([401, 'invalid_provider_token']);
    expect([asGoogle.status, asGoogle.error]).toEqual([401, 'invalid_provider_token']);
  });

  it('joins the member who already has the address, when the provider vouches for it', async () => {
    const email = freshEmail();
    await post(IDENTITY_PATHS.signUp, { email, password: PASSWORD, redirectTo: VERIFY_URL });
    const link = new URL(sent.find((message) => message.to === email)?.link as string);
    const byEmail = await post(IDENTITY_PATHS.verify, { token: link.searchParams.get('token_hash'), type: 'signup' });

    const byGoogle = await withGoogle({ sub: `g-${email}`, email });

    expect(byGoogle.session.user.id).toBe(byEmail.session.user.id);
    expect(await membersWith(email)).toBe(1);
    // Both ways in keep working.
    expect((await post(IDENTITY_PATHS.signIn, { email, password: PASSWORD })).status).toBe(200);
  });

  it('gives the address to whoever proved it: a sign-up that never verified it loses its password and its link', async () => {
    const email = freshEmail();
    // Someone typed this address and a password of their own, and never opened the link.
    await post(IDENTITY_PATHS.signUp, { email, password: 'chosen by someone 1', redirectTo: VERIFY_URL });
    const link = new URL(sent.find((message) => message.to === email)?.link as string);

    const owner = await withGoogle({ sub: `g-${email}`, email });

    expect(owner.status).toBe(200);
    expect((await memberOf(owner.session.user.id))?.status).toBe('active');
    expect((await post(IDENTITY_PATHS.signIn, { email, password: 'chosen by someone 1' })).error).toBe('invalid_credentials');
    expect((await post(IDENTITY_PATHS.verify, { token: link.searchParams.get('token_hash'), type: 'signup' })).error).toBe('invalid_link');
    expect(await membersWith(email)).toBe(1);
  });

  it('refuses a first sign-in whose address the provider does not vouch for, and creates nobody', async () => {
    const email = freshEmail();

    const answer = await withGoogle({ sub: `g-${email}`, email, email_verified: false });

    expect([answer.status, answer.error]).toEqual([403, 'email_not_verified']);
    expect(await membersWith(email)).toBe(0);
  });

  it('makes one member of two first sign-ins of one account that arrive together', async () => {
    const email = freshEmail();
    const claims = { sub: `g-${email}`, email };

    const [one, two] = await Promise.all([withGoogle(claims), withGoogle(claims)]);

    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.session.user.id).toBe(two.session.user.id);
    expect(await membersWith(email)).toBe(1);
  });

  it('refuses a token Google did not sign, and a request that is not a sign-in', async () => {
    const email = freshEmail();
    const forged = await google.idToken({ sub: `g-${email}`, email, email_verified: true }, { foreignKey: true });

    const answers = [
      await post(IDENTITY_PATHS.idToken, { provider: 'google', token: forged }),
      await post(IDENTITY_PATHS.idToken, { provider: 'facebook', token: forged }),
      await post(IDENTITY_PATHS.idToken, { provider: 'google' }),
    ];

    expect(answers.map((answer) => [answer.status, answer.error])).toEqual([[401, 'invalid_provider_token'], [400, 'invalid_request'], [400, 'invalid_request']]);
    expect(await membersWith(email)).toBe(0);
  });
});
