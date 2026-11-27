import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { IDENTITY_PATHS, type SessionResponse } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdentityEmail } from '../../modules/identity/emailSender';
import { SessionService } from '../../modules/identity/sessionService';
import { BackgroundWork } from '../../platform/background/backgroundWork';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { startIdentityApp } from '../support/identityApp';
import { KcTestDatabase } from '../support/kcDatabase';

const VERIFY_URL = 'https://app.kc.test/auth/verify';
const RESET_URL = 'https://app.kc.test/auth/reset-password';
const PASSWORD = 'correct horse 9';

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** The API's error code, when the answer is a refusal. */
  readonly error: string | undefined;
}

/**
 * Accounts that sign in with an email address and a password, on KC's own
 * identity and the KC schema (ADR-013 section 3), through the real routes.
 * Only the email provider is a stand-in: it keeps what it was asked to send.
 */
describe('Email accounts of KC\'s own identity, on the KC schema', () => {
  const database = new KcTestDatabase();
  const sent: IdentityEmail[] = [];
  let app: NestFastifyApplication;

  /** An address no other test or run uses. */
  const freshEmail = () => `member-${randomUUID().slice(0, 12)}@identity.test`;
  const post = async (path: string, payload: unknown, accessToken?: string): Promise<Answer> => {
    const response = await app.inject({ method: 'POST', url: path, payload: payload as object, headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
    // An email is handed to the provider after the answer: wait for it, so a test sees what its request caused.
    await app.get(BackgroundWork).idle();
    const body = response.json<Record<string, unknown>>();
    return { status: response.statusCode, body, error: (body.error as { code?: string } | undefined)?.code };
  };
  const sessionOf = (answer: Answer) => answer.body as unknown as SessionResponse;
  const signUp = (email: string, password = PASSWORD, redirectTo: unknown = VERIFY_URL) => post(IDENTITY_PATHS.signUp, { email, password, redirectTo });
  const signIn = (email: string, password = PASSWORD) => post(IDENTITY_PATHS.signIn, { email, password });
  /** The emails sent to an address, oldest first. */
  const emailsTo = (email: string) => sent.filter((message) => message.to === email.toLowerCase());
  /** The token and type a link carries, as the app's screen reads them from its address. */
  const linkOf = (message: IdentityEmail | undefined) => {
    const url = new URL(message?.link ?? 'https://no-email.test');
    return { page: `${url.origin}${url.pathname}`, token: url.searchParams.get('token_hash') as string, type: url.searchParams.get('type') as string };
  };
  const redeem = (message: IdentityEmail | undefined) => post(IDENTITY_PATHS.verify, { token: linkOf(message).token, type: linkOf(message).type });
  /** A member who signed up, opened their link and so is signed in. */
  const verifiedMember = async () => {
    const email = freshEmail();
    await signUp(email);
    return { email, session: sessionOf(await redeem(emailsTo(email)[0])) };
  };
  const whoIs = async (accessToken: string): Promise<string | number> => {
    const response = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: `Bearer ${accessToken}` } });
    return response.statusCode === 200 ? response.json<{ userId: string }>().userId : response.statusCode;
  };
  const membersWith = async (email: string) => (await database.admin.query('select 1 from auth.users where email = $1', [email.toLowerCase()])).rowCount;
  /** Moves the member's links into the past, as if `interval` had gone by since they were made. */
  const ageLinksOf = (email: string, interval: string) =>
    database.admin.query(
      'update kc_private.auth_one_time_tokens set created_at = created_at - $2::interval, expires_at = expires_at - $2::interval where user_id = kc_private.auth_user_id_by_email($1)',
      [email, interval],
    );

  beforeAll(async () => {
    app = await startIdentityApp({ emailSender: { send: (message) => (sent.push(message), Promise.resolve()) }, authRedirectUrls: [VERIFY_URL, RESET_URL] });
  });

  afterAll(async () => {
    await database.admin.query("delete from auth.users where email like 'member-%@identity.test'");
    await app.close();
    await database.close();
  });

  it('signs a member up: the account waits for its link, the link activates it and signs the member in, once', async () => {
    const email = freshEmail().replace('member-', 'Member-');

    const answer = await signUp(email);
    const [message] = emailsTo(email);
    const beforeTheLink = await signIn(email);
    const redeemed = await redeem(message);

    expect([answer.status, answer.body]).toEqual([200, {}]);
    expect(emailsTo(email)).toHaveLength(1);
    expect(message).toMatchObject({ to: email.toLowerCase(), kind: 'verify_email' });
    expect(linkOf(message)).toMatchObject({ page: VERIFY_URL, type: 'signup' });
    expect([beforeTheLink.status, beforeTheLink.error]).toEqual([403, 'email_not_confirmed']);
    expect(redeemed.status).toBe(200);
    expect(sessionOf(redeemed).user).toMatchObject({ email: email.toLowerCase(), emailVerified: true, provider: 'email' });
    expect(await whoIs(sessionOf(redeemed).accessToken)).toBe(sessionOf(redeemed).user.id);
    const account = await database.admin.query<{ status: string }>('select status::text from public.user_account where user_id = $1', [sessionOf(redeemed).user.id]);
    expect(account.rows[0]?.status).toBe('active');
    expect((await signIn(email)).status).toBe(200);
    expect([(await redeem(message)).status, (await redeem(message)).error]).toEqual([401, 'invalid_link']);
  });

  it('answers a sign-up for a taken address exactly as for a free one, and creates and sends nothing', async () => {
    const { email } = await verifiedMember();
    // A member who signed up another way has the address too.
    const elsewhere = await database.newMember();
    const theirEmail = `contract-${elsewhere.userId.slice(0, 8)}@kc.test`;
    sent.length = 0;

    const [again, otherMethod, free] = [await signUp(email, 'another pass 1'), await signUp(theirEmail), await signUp(freshEmail())];

    expect([again.status, again.body]).toEqual([free.status, free.body]);
    expect([otherMethod.status, otherMethod.body]).toEqual([free.status, free.body]);
    expect(emailsTo(email)).toEqual([]);
    expect(emailsTo(theirEmail)).toEqual([]);
    expect([await membersWith(email), await membersWith(theirEmail)]).toEqual([1, 1]);
    // The first password still is the account's: the second sign-up changed nothing.
    expect([(await signIn(email)).status, (await signIn(email, 'another pass 1')).status]).toEqual([200, 401]);
  });

  it('creates one account when two sign-ups for one address arrive together', async () => {
    const email = freshEmail();

    const answers = await Promise.all([signUp(email), signUp(email)]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(await membersWith(email)).toBe(1);
    expect(emailsTo(email)).toHaveLength(1);
  });

  it('refuses a wrong password and an unknown address with the same answer', async () => {
    const { email } = await verifiedMember();

    const [wrongPassword, unknownAddress] = [await signIn(email, 'wrong horse 9'), await signIn(freshEmail())];

    expect([wrongPassword.status, wrongPassword.error]).toEqual([401, 'invalid_credentials']);
    expect({ ...unknownAddress, body: null }).toEqual({ ...wrongPassword, body: null });
    expect(Object.keys(unknownAddress.body)).toEqual(Object.keys(wrongPassword.body));
  });

  it.each([
    ['a password without a digit', { password: 'only letters' }, 'weak_password'],
    ['a password of seven characters', { password: 'short 1' }, 'weak_password'],
    ['something that is not an address', { email: 'not-an-address' }, 'invalid_request'],
    ['no password', { password: undefined }, 'invalid_request'],
    ['a link address the API does not allow', { redirectTo: 'https://elsewhere.test/auth/verify' }, 'invalid_request'],
    ['a link address that only starts like an allowed one', { redirectTo: `${VERIFY_URL}.elsewhere.test` }, 'invalid_request'],
    ['no link address', { redirectTo: undefined }, 'invalid_request'],
  ])('refuses a sign-up with %s, and creates nothing', async (_what, change, code) => {
    const request = { email: freshEmail(), password: PASSWORD, redirectTo: VERIFY_URL, ...change };

    const answer = await post(IDENTITY_PATHS.signUp, request);

    expect([answer.status, answer.error]).toEqual([400, code]);
    expect(await membersWith(String(request.email))).toBe(0);
  });

  it('resets a password by its link: the link signs the member in once, the new password ends every session and replaces the old one', async () => {
    const { email, session: elsewhere } = await verifiedMember();
    sent.length = 0;

    const asked = await post(IDENTITY_PATHS.recover, { email, redirectTo: RESET_URL });
    const [message] = emailsTo(email);
    const recovery = sessionOf(await redeem(message));
    const changed = await post(IDENTITY_PATHS.password, { password: 'brand new pass 2' }, recovery.accessToken);

    expect([asked.status, asked.body]).toEqual([200, {}]);
    expect(message).toMatchObject({ kind: 'reset_password' });
    expect(linkOf(message)).toMatchObject({ page: RESET_URL, type: 'recovery' });
    expect(changed.status).toBe(200);
    // Every device signs in again (FR-AUTH-008 AC2): the one that reset the password and the one that was signed in before.
    expect([await whoIs(recovery.accessToken), await whoIs(elsewhere.accessToken)]).toEqual([401, 401]);
    expect((await post(IDENTITY_PATHS.token, { refreshToken: elsewhere.refreshToken })).status).toBe(401);
    expect([(await signIn(email, 'brand new pass 2')).status, (await signIn(email)).status]).toEqual([200, 401]);
    expect((await redeem(message)).error).toBe('invalid_link');
  });

  it('answers a reset request alike for every address, sends to none it does not know, and at most one email a minute', async () => {
    const { email } = await verifiedMember();
    const unknown = freshEmail();
    sent.length = 0;

    const answers = [await post(IDENTITY_PATHS.recover, { email, redirectTo: RESET_URL }), await post(IDENTITY_PATHS.recover, { email: unknown, redirectTo: RESET_URL })];
    const second = await post(IDENTITY_PATHS.recover, { email, redirectTo: RESET_URL });

    expect(answers.map((answer) => [answer.status, answer.body])).toEqual([[200, {}], [200, {}]]);
    expect(second.status).toBe(200);
    expect(emailsTo(email)).toHaveLength(1);
    expect(emailsTo(unknown)).toEqual([]);
  });

  it('sends a verification link again after a minute, to an account that still needs it; the link before stops working', async () => {
    const email = freshEmail();
    await signUp(email);
    const [first] = emailsTo(email);

    const tooSoon = await post(IDENTITY_PATHS.resend, { email, redirectTo: VERIFY_URL });
    await ageLinksOf(email, '61 seconds');
    const later = await post(IDENTITY_PATHS.resend, { email, redirectTo: VERIFY_URL });
    const [, second] = emailsTo(email);

    expect([tooSoon.status, later.status]).toEqual([200, 200]);
    expect(emailsTo(email)).toHaveLength(2);
    expect((await redeem(first)).error).toBe('invalid_link');
    expect((await redeem(second)).status).toBe(200);
    // Verified now: asking again sends nothing.
    await ageLinksOf(email, '61 seconds');
    await post(IDENTITY_PATHS.resend, { email, redirectTo: VERIFY_URL });
    expect(emailsTo(email)).toHaveLength(2);
  });

  it('refuses a link that expired', async () => {
    const email = freshEmail();
    await signUp(email);
    // A verification link works for 24 hours.
    await ageLinksOf(email, '24 hours 1 minute');

    expect((await redeem(emailsTo(email)[0])).error).toBe('invalid_link');
    expect((await post(IDENTITY_PATHS.verify, { token: 'x', type: 'magic' })).status).toBe(400);
  });

  it('signs in a member whose password was carried over from Supabase Auth, and replaces the old hash on the way', async () => {
    const elsewhere = await database.newMember();
    const email = `contract-${elsewhere.userId.slice(0, 8)}@kc.test`;
    // What the copy of the existing accounts writes: the email identity and the bcrypt hash as it was.
    await database.admin.query("insert into kc_private.auth_identities (user_id, provider, subject) values ($1, 'email', $2)", [elsewhere.userId, email]);
    await database.admin.query('insert into kc_private.auth_passwords (user_id, hash) values ($1, $2)', [elsewhere.userId, bcrypt.hashSync('set long ago 1', 10)]);
    const storedHash = async () => (await database.admin.query<{ hash: string }>('select hash from kc_private.auth_passwords where user_id = $1', [elsewhere.userId])).rows[0]?.hash;

    const first = await signIn(email, 'set long ago 1');

    expect(first.status).toBe(200);
    expect(sessionOf(first).user.id).toBe(elsewhere.userId);
    expect(await storedHash()).toMatch(/^scrypt\$/);
    expect([(await signIn(email, 'set long ago 1')).status, (await signIn(email, 'set long ago 2')).status]).toEqual([200, 401]);
  });

  it('keeps the name and picture of the sign-in profile in step, and lets only an email account set a password', async () => {
    const { session } = await verifiedMember();
    const other = await database.newMember();

    const updated = await post(IDENTITY_PATHS.profile, { displayName: 'Dana Levi', avatarUrl: 'https://media.kc.test/dana.jpg' }, session.accessToken);
    const refreshed = sessionOf(await post(IDENTITY_PATHS.token, { refreshToken: session.refreshToken }));
    const empty = await post(IDENTITY_PATHS.profile, {}, session.accessToken);

    expect([updated.status, empty.status]).toEqual([200, 400]);
    expect(refreshed.user).toMatchObject({ displayName: 'Dana Levi', avatarUrl: 'https://media.kc.test/dana.jpg' });
    expect((await post(IDENTITY_PATHS.profile, { displayName: 'x' })).status).toBe(401);
    expect((await post(IDENTITY_PATHS.password, { password: 'weak' }, refreshed.accessToken)).error).toBe('weak_password');
    // A member who signed up another way has no email identity, and so no password to set.
    const theirs = await app.get(IdentityDatabase).runAsService((db) => app.get(SessionService).openFor(db, other.userId));
    const refused = await post(IDENTITY_PATHS.password, { password: PASSWORD }, theirs.accessToken);
    expect([refused.status, refused.error]).toEqual([400, 'invalid_request']);
    expect(await whoIs(theirs.accessToken)).toBe(other.userId);
  });

  it('answers 503 for what needs an email provider on a server that has none, and still signs members in', async () => {
    const { email } = await verifiedMember();
    const withoutProvider = await startIdentityApp({ authRedirectUrls: [VERIFY_URL, RESET_URL] });
    const ask = async (path: string, payload: object) => (await withoutProvider.inject({ method: 'POST', url: path, payload })).statusCode;

    try {
      expect(await ask(IDENTITY_PATHS.signUp, { email: freshEmail(), password: PASSWORD, redirectTo: VERIFY_URL })).toBe(503);
      expect(await ask(IDENTITY_PATHS.recover, { email, redirectTo: RESET_URL })).toBe(503);
      expect(await ask(IDENTITY_PATHS.resend, { email, redirectTo: VERIFY_URL })).toBe(503);
      // Another server's signing keys, the same database: the account and its password are the database's.
      expect(await ask(IDENTITY_PATHS.signIn, { email, password: PASSWORD })).toBe(200);
    } finally {
      await withoutProvider.close();
    }
  });
});
