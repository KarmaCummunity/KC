import { describe, expect, it } from 'vitest';
import { type AccessTokenVerifier, InvalidAccessTokenError } from '../accessTokenVerifier';
import { withSessionCheck } from '../sessionCheckedVerifier';
import { createSessionLiveness } from '../sessionLiveness';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '99999999-9999-4999-8999-999999999999';

/** A verifier that accepts every token as `USER` with the given claims. */
const accepting = (claims: Record<string, unknown>): AccessTokenVerifier => ({ verify: () => Promise.resolve({ userId: USER, claims: { sub: USER, ...claims } }) });

describe('withSessionCheck', () => {
  it('accepts a token whose session is live, and asks about exactly that session and member', async () => {
    const asked: string[][] = [];
    const verifier = withSessionCheck(accepting({ sid: SESSION }), { isLive: (sessionId, userId) => (asked.push([sessionId, userId]), Promise.resolve(true)) });

    await expect(verifier.verify('token')).resolves.toMatchObject({ userId: USER });
    expect(asked).toEqual([[SESSION, USER]]);
  });

  it('refuses a token whose session ended, and one that names no session', async () => {
    const ended = withSessionCheck(accepting({ sid: SESSION }), { isLive: () => Promise.resolve(false) });
    const unnamed = withSessionCheck(accepting({}), { isLive: () => Promise.resolve(true) });

    await expect(ended.verify('token')).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(unnamed.verify('token')).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('does not ask about a token the signature check refused', async () => {
    const refusing: AccessTokenVerifier = { verify: () => Promise.reject(new InvalidAccessTokenError('forged')) };
    let asked = false;

    await expect(withSessionCheck(refusing, { isLive: () => ((asked = true), Promise.resolve(true)) }).verify('token')).rejects.toThrow('forged');
    expect(asked).toBe(false);
  });

  it('lets a database failure surface as a fault, never as "sign in again"', async () => {
    const failing = withSessionCheck(accepting({ sid: SESSION }), { isLive: () => Promise.reject(new Error('connection lost')) });

    const failure = await failing.verify('token').catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(InvalidAccessTokenError);
    expect((failure as Error).message).toBe('connection lost');
  });
});

describe('createSessionLiveness', () => {
  it('asks nothing, and answers no, for an id that is not a UUID: the ids are written into the statement', async () => {
    let connected = false;
    const sessions = createSessionLiveness({ connect: () => ((connected = true), Promise.reject(new Error('not reached'))) });

    expect(await sessions.isLive("x'; drop table kc_private.auth_sessions; --", USER)).toBe(false);
    expect(await sessions.isLive(SESSION, 'not-a-uuid')).toBe(false);
    expect(connected).toBe(false);
  });
});
