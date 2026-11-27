import 'reflect-metadata';
import { IDENTITY_PATHS, type SessionResponse } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../../modules/identity/sessionService';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { startIdentityApp } from '../support/identityApp';
import { KcTestDatabase, type TestMember } from '../support/kcDatabase';

/**
 * The sessions of KC's own identity (ADR-013 section 2) on the KC schema,
 * through the real routes: a session is continued by a refresh token that
 * works once, ends when it should, and its access tokens stop being accepted
 * the moment it ends.
 */
describe('Sessions of KC\'s own identity, on the KC schema', () => {
  const database = new KcTestDatabase();
  let app: NestFastifyApplication;

  /** A session for a member who "just signed in": what every sign-in route ends with. */
  const signIn = (member: TestMember): Promise<SessionResponse> =>
    app.get(IdentityDatabase).runAsService((db) => app.get(SessionService).openFor(db, member.userId));
  const refresh = async (refreshToken: unknown) => {
    const response = await app.inject({ method: 'POST', url: IDENTITY_PATHS.token, payload: { refreshToken } });
    return { status: response.statusCode, session: response.json<SessionResponse>(), error: response.json<{ error?: { code: string } }>().error?.code };
  };
  const signOut = (accessToken: string, scope: unknown) =>
    app.inject({ method: 'POST', url: IDENTITY_PATHS.signOut, payload: { scope }, headers: { authorization: `Bearer ${accessToken}` } });
  /** Who the database says the token is: the member's id, or the status of the refusal. */
  const whoIs = async (accessToken: string): Promise<string | number> => {
    const response = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: `Bearer ${accessToken}` } });
    return response.statusCode === 200 ? response.json<{ userId: string }>().userId : response.statusCode;
  };
  const sessionRow = async (accessToken: string) =>
    (await database.admin.query<{ ended_reason: string | null }>('select ended_reason from kc_private.auth_sessions where id = $1', [decodeJwt(accessToken).sid])).rows[0];

  beforeAll(async () => {
    app = await startIdentityApp();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('signs a member in with a token the database sees as them, and describes them as the app expects', async () => {
    const alice = await database.newMember();

    const session = await signIn(alice);

    expect(await whoIs(session.accessToken)).toBe(alice.userId);
    expect(session.user).toMatchObject({ id: alice.userId, email: `contract-${alice.userId.slice(0, 8)}@kc.test`, emailVerified: true, phone: null, provider: null });
    expect(Date.parse(session.user.createdAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(session.expiresAt).toBeGreaterThan(Date.now() / 1000 + 3500);
  });

  it('continues a session with a refresh token that is replaced at every use', async () => {
    const alice = await database.newMember();
    const first = await signIn(alice);

    const second = await refresh(first.refreshToken);
    const third = await refresh(second.session.refreshToken);

    expect([second.status, third.status]).toEqual([200, 200]);
    expect(new Set([first.refreshToken, second.session.refreshToken, third.session.refreshToken]).size).toBe(3);
    // The same session throughout: one sign-in on one device.
    expect(decodeJwt(third.session.accessToken).sid).toBe(decodeJwt(first.accessToken).sid);
    expect(await whoIs(third.session.accessToken)).toBe(alice.userId);
    expect(third.session.user.id).toBe(alice.userId);
  });

  it('gives each of two requests racing with one refresh token a session that works', async () => {
    const alice = await database.newMember();
    const { refreshToken } = await signIn(alice);

    const [one, two] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);

    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.session.refreshToken).not.toBe(two.session.refreshToken);
    expect([(await refresh(one.session.refreshToken)).status, (await refresh(two.session.refreshToken)).status]).toEqual([200, 200]);
  });

  it('ends the session when a refresh token that was replaced long ago is presented again: it was copied', async () => {
    const alice = await database.newMember();
    const first = await signIn(alice);
    const second = await refresh(first.refreshToken);
    // The first token was replaced eleven seconds ago: past the time two requests of one app can race.
    await database.admin.query("update kc_private.auth_refresh_tokens set replaced_at = now() - interval '11 seconds' where replaced_at is not null and session_id = $1", [
      decodeJwt(first.accessToken).sid,
    ]);

    const replayed = await refresh(first.refreshToken);

    expect([replayed.status, replayed.error]).toEqual([401, 'invalid_refresh_token']);
    expect(await sessionRow(first.accessToken)).toEqual({ ended_reason: 'token_reuse' });
    // Whoever holds the newest token is signed out too: nobody can tell which of the two is the member.
    expect((await refresh(second.session.refreshToken)).status).toBe(401);
    expect(await whoIs(second.session.accessToken)).toBe(401);
  });

  it('signs one device out: its tokens stop working at once, the member\'s other device stays signed in', async () => {
    const alice = await database.newMember();
    const [phone, laptop] = [await signIn(alice), await signIn(alice)];

    const response = await signOut(phone.accessToken, 'device');

    expect(response.statusCode).toBe(200);
    expect(await whoIs(phone.accessToken)).toBe(401);
    expect((await refresh(phone.refreshToken)).error).toBe('invalid_refresh_token');
    expect(await sessionRow(phone.accessToken)).toEqual({ ended_reason: 'signed_out' });
    expect(await whoIs(laptop.accessToken)).toBe(alice.userId);
    expect((await refresh(laptop.refreshToken)).status).toBe(200);
  });

  it('signs a member out everywhere, and nobody else', async () => {
    const [alice, bob] = [await database.newMember(), await database.newMember()];
    const [phone, laptop, bobs] = [await signIn(alice), await signIn(alice), await signIn(bob)];

    await signOut(phone.accessToken, 'everywhere');

    expect([await whoIs(phone.accessToken), await whoIs(laptop.accessToken)]).toEqual([401, 401]);
    expect((await refresh(laptop.refreshToken)).status).toBe(401);
    expect(await sessionRow(laptop.accessToken)).toEqual({ ended_reason: 'signed_out_everywhere' });
    expect(await whoIs(bobs.accessToken)).toBe(bob.userId);
  });

  it('lets a session lapse after 30 days without a refresh', async () => {
    const alice = await database.newMember();
    const session = await signIn(alice);
    await database.admin.query("update kc_private.auth_sessions set refreshed_at = now() - interval '30 days 1 minute' where id = $1", [decodeJwt(session.accessToken).sid]);

    expect(await whoIs(session.accessToken)).toBe(401);
    expect((await refresh(session.refreshToken)).error).toBe('invalid_refresh_token');
  });

  it('accepts nothing of a member whose account was removed', async () => {
    const alice = await database.newMember();
    const session = await signIn(alice);
    await database.admin.query('delete from auth.users where id = $1', [alice.userId]);

    expect(await whoIs(session.accessToken)).toBe(401);
    expect((await refresh(session.refreshToken)).status).toBe(401);
  });

  it.each([[undefined], [''], [42], ['x'.repeat(201)]])('refuses a refresh request without a usable token: %j', async (refreshToken) => {
    expect((await refresh(refreshToken)).status).toBe(400);
  });

  it('refuses a refresh token it never issued, and a sign-out without a scope or without a session', async () => {
    const alice = await database.newMember();
    const session = await signIn(alice);

    expect((await refresh('never-issued-by-anyone')).error).toBe('invalid_refresh_token');
    expect((await signOut(session.accessToken, 'all')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: IDENTITY_PATHS.signOut, payload: { scope: 'device' } })).statusCode).toBe(401);
    expect(await whoIs(session.accessToken)).toBe(alice.userId);
  });

  it('marks a session answer as not to be stored by anything in between', async () => {
    const { refreshToken } = await signIn(await database.newMember());

    const response = await app.inject({ method: 'POST', url: IDENTITY_PATHS.token, payload: { refreshToken } });

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
