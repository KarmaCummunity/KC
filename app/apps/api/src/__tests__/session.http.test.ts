import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../createApp';
import { SessionModule } from '../modules/session/session.module';
import { ApiConfigModule } from '../platform/config/apiConfig.module';
import { type DatabaseSession, IdentityDatabase } from '../platform/database/identityDatabase';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../platform/identity/accessTokenVerifier';
import type { CallerIdentity } from '../platform/identity/callerIdentity';
import { testConfig } from './support/testConfig';
import { createTestIssuer, type TestIssuer, USER_A, USER_B } from './support/testTokens';

/**
 * Stand-in for the identity-scoped database: answers `auth.uid()` with the
 * caller it was asked to run as, or with `resolveAs` to simulate a broken bridge.
 */
class FakeIdentityDatabase {
  resolveAs: string | null | undefined;
  callers: CallerIdentity[] = [];

  runAs<T>(identity: CallerIdentity, work: (session: DatabaseSession) => Promise<T>): Promise<T> {
    this.callers.push(identity);
    const userId = this.resolveAs === undefined ? identity.userId : this.resolveAs;
    const session = { query: () => Promise.resolve({ rows: [{ user_id: userId }] }) } as unknown as DatabaseSession;
    return work(session);
  }
}

describe('GET /v1/session', () => {
  let app: NestFastifyApplication;
  let issuer: TestIssuer;
  const database = new FakeIdentityDatabase();
  /** Swapped per test to simulate verifier outages; delegates to the issuer by default. */
  let verify: AccessTokenVerifier['verify'];

  beforeAll(async () => {
    issuer = await createTestIssuer();
    const verifier: AccessTokenVerifier = { verify: (token) => verify(token) };

    @Global()
    @Module({
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: IdentityDatabase, useValue: database },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, IdentityDatabase],
    })
    class FakePlatformModule {}

    @Module({ imports: [ApiConfigModule.forRoot(testConfig()), FakePlatformModule, SessionModule] })
    class TestModule {}

    app = await createApp(TestModule, testConfig());
  });

  beforeEach(() => {
    verify = (token) => issuer.verifier.verify(token);
    database.resolveAs = undefined;
    database.callers = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (authorization?: string) =>
    app.inject({ method: 'GET', url: '/v1/session', headers: authorization ? { authorization } : {} });

  it('returns the caller the database resolved', async () => {
    const response = await get(`Bearer ${await issuer.sign(USER_A)}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: USER_A });
    expect(database.callers.map((caller) => caller.userId)).toEqual([USER_A]);
  });

  it('keeps two callers apart', async () => {
    const first = await get(`Bearer ${await issuer.sign(USER_A)}`);
    const second = await get(`Bearer ${await issuer.sign(USER_B)}`);

    expect([first.json().userId, second.json().userId]).toEqual([USER_A, USER_B]);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer token', 'Bearer '],
    ['a bearer token with a space in it', 'Bearer abc def'],
    ['text that is not a token', 'Bearer not.a.token'],
  ])('answers 401 to %s without touching the database', async (_case, authorization) => {
    const response = await get(authorization);

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
    expect(database.callers).toEqual([]);
  });

  it('answers 401 to an expired token and does not say why', async () => {
    const response = await get(`Bearer ${await issuer.sign(USER_A, { expiresInSeconds: -60 })}`);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'unauthorized', requestId: response.headers['x-request-id'] } });
  });

  it('answers 500, not 401, when the verifier itself fails', async () => {
    verify = () => Promise.reject(new TypeError('fetch failed'));

    const response = await get(`Bearer ${await issuer.sign(USER_A)}`);

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
  });

  it.each([
    ['another user', USER_B],
    ['nobody', null],
  ])('answers 500 when the database resolves %s', async (_case, resolved) => {
    database.resolveAs = resolved;

    const response = await get(`Bearer ${await issuer.sign(USER_A)}`);

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(USER_B);
  });
});
