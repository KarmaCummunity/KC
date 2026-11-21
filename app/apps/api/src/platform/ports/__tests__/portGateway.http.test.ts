import 'reflect-metadata';
import { FollowError } from '@kc/application';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig } from '../../../__tests__/support/testConfig';
import { createTestIssuer, type TestIssuer, USER_A } from '../../../__tests__/support/testTokens';
import { createApp } from '../../../createApp';
import { ApiConfigModule } from '../../config/apiConfig.module';
import { DATABASE_POOL } from '../../database/database.tokens';
import { IdentityDatabase } from '../../database/identityDatabase';
import { ACCESS_TOKEN_VERIFIER } from '../../identity/accessTokenVerifier';
import { type SqlBackedClient } from '../../postgrest/sqlBackedClient';
import { RateLimiter } from '../../rateLimit/rateLimiter';
import { definePort } from '../portDefinition';
import { DuplicatePortError, indexPorts, PortGatewayModule } from '../portGateway.module';

/** A port with one method of each kind the gateway must handle. */
interface Shelf {
  echo(first: string, second?: number, third?: string): Promise<unknown>;
  whoAmI(): Promise<string | null>;
  nothing(): Promise<void>;
  refuse(): Promise<never>;
  crash(): Promise<never>;
  needsStorage(): Promise<unknown>;
  upload(): Promise<void>;
}

class ShelfImplementation implements Shelf {
  /** A helper the port interface does not have; it must never be callable. */
  secret = () => 'internal';

  constructor(private readonly client: SqlBackedClient) {}

  echo(first: string, second?: number, third?: string) {
    return Promise.resolve({ first, second: second === undefined ? 'undefined' : second, third: third ?? 'default' });
  }
  async whoAmI() {
    return (await this.client.auth.getUser()).data.user?.id ?? null;
  }
  nothing() {
    return Promise.resolve();
  }
  refuse(): Promise<never> {
    return Promise.reject(new FollowError('cooldown_active', 'wait', { cooldownUntil: '2026-12-01T00:00:00Z', cause: new Error('pg detail') }));
  }
  crash(): Promise<never> {
    return Promise.reject(new Error('password=hunter2'));
  }
  needsStorage() {
    return Promise.resolve((this.client as unknown as { storage: unknown }).storage);
  }
  upload() {
    return Promise.resolve();
  }
}

const shelf = definePort<Shelf>({
  name: 'shelf',
  create: (client) => new ShelfImplementation(client),
  methods: { echo: 'member', whoAmI: 'public', nothing: 'member', refuse: 'member', crash: 'member', needsStorage: 'member', upload: 'not_served' },
});

/** Stand-in for the Redis limiter: allows everything until a test sets `blocked`, and records who was counted. */
const limiter = {
  blocked: false,
  subjects: [] as string[],
  check(subject: string) {
    this.subjects.push(subject);
    return Promise.resolve(this.blocked ? { allowed: false, retryAfterSeconds: 42 } : { allowed: true, retryAfterSeconds: 0 });
  },
};

describe('port gateway over HTTP', () => {
  let app: NestFastifyApplication;
  let issuer: TestIssuer;
  let token: string;

  beforeAll(async () => {
    issuer = await createTestIssuer();

    // The shelf never queries, so the database behind the clients can be inert.
    @Global()
    @Module({
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: issuer.verifier },
        { provide: DATABASE_POOL, useValue: {} },
        { provide: IdentityDatabase, useValue: {} },
        { provide: RateLimiter, useValue: limiter },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, DATABASE_POOL, IdentityDatabase, RateLimiter],
    })
    class FakePlatformModule {}

    @Module({ imports: [ApiConfigModule.forRoot(testConfig()), FakePlatformModule, PortGatewayModule.forRoot([shelf])] })
    class TestModule {}

    app = await createApp(TestModule, testConfig());
  });

  beforeEach(async () => {
    token = await issuer.sign(USER_A);
    limiter.blocked = false;
    limiter.subjects = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (path: string, args: unknown, authorization: string | null = `Bearer ${token}`) =>
    app.inject({
      method: 'POST',
      url: `/v1/ports/${path}`,
      payload: { args },
      headers: authorization ? { authorization } : {},
    });

  it('runs the method with the arguments and returns its result', async () => {
    const response = await call('shelf/echo', ['a', 2, 'c']);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { first: 'a', second: 2, third: 'c' } });
  });

  it('keeps a skipped argument skipped and lets defaults apply to omitted ones', async () => {
    const response = await call('shelf/echo', ['a', { $undefined: true }]);

    expect(response.json()).toEqual({ result: { first: 'a', second: 'undefined', third: 'default' } });
  });

  it('answers a method that returns nothing with an empty object', async () => {
    expect((await call('shelf/nothing', [])).json()).toEqual({});
  });

  it('runs a member method as the caller the token proves', async () => {
    expect((await call('shelf/whoAmI', [])).json()).toEqual({ result: USER_A });
  });

  it('runs a public method for a signed-out visitor, with no caller', async () => {
    const response = await call('shelf/whoAmI', [], null);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: null });
  });

  it('refuses a member method without a token, and any method with a bad token', async () => {
    expect((await call('shelf/echo', ['a'], null)).statusCode).toBe(401);
    expect((await call('shelf/echo', ['a'], 'Bearer not.a.token')).statusCode).toBe(401);
    // A broken session is never downgraded to "signed out", even where visitors are welcome.
    expect((await call('shelf/whoAmI', [], 'Bearer not.a.token')).statusCode).toBe(401);
    expect((await call('shelf/whoAmI', [], 'Basic abc')).statusCode).toBe(401);
  });

  it.each(['nope/echo', 'shelf/nope', 'shelf/secret', 'shelf/constructor', 'shelf/toString', 'shelf/__proto__', 'shelf/hasOwnProperty'])(
    'answers 404 for %s',
    async (path) => {
      const response = await call(path, []);

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('port_method_not_found');
    },
  );

  it('answers 501 for a method the API does not carry yet', async () => {
    expect((await call('shelf/upload', [])).json().error.code).toBe('port_method_not_served');
    expect((await call('shelf/needsStorage', [])).statusCode).toBe(501);
  });

  it.each([
    ['no args key', {}],
    ['args that are not an array', { args: 'a' }],
    ['too many args', { args: Array.from({ length: 17 }, () => 1) }],
  ])('answers 400 for a body with %s', async (_case, payload) => {
    const response = await app.inject({ method: 'POST', url: '/v1/ports/shelf/echo', payload, headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(400);
  });

  it('counts a member by user id and a visitor by address', async () => {
    await call('shelf/whoAmI', []);
    await call('shelf/whoAmI', [], null);

    expect(limiter.subjects).toEqual([`user:${USER_A}`, 'ip:127.0.0.1']);
  });

  it('answers 429 with the time to wait when the caller is over the limit, without running the method', async () => {
    limiter.blocked = true;

    const response = await call('shelf/crash', []);

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('too_many_requests');
    expect(response.headers['retry-after']).toBe('42');
  });

  it('does not count a call that was refused before it reached a method', async () => {
    await call('shelf/echo', ['a'], null);
    await call('shelf/nope', []);

    expect(limiter.subjects).toEqual([]);
  });

  it('sends a typed port error to the app as itself, without its cause', async () => {
    const response = await call('shelf/refuse', []);

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: 'port_error',
      detail: { port: { type: 'FollowError', message: 'wait', fields: { code: 'cooldown_active', cooldownUntil: '2026-12-01T00:00:00Z' } } },
    });
    expect(response.body).not.toContain('pg detail');
  });

  it('hides an unexpected failure behind internal_error', async () => {
    const response = await call('shelf/crash', []);

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
    expect(response.body).not.toContain('hunter2');
  });

  it('refuses two ports with one name at start-up', () => {
    expect(() => indexPorts([shelf, shelf])).toThrow(DuplicatePortError);
    expect(indexPorts([shelf]).get('shelf')).toBe(shelf);
  });
});

describe('port manifest', () => {
  it('lists what a definition serves and leaves out what it does not', async () => {
    const issuer = await createTestIssuer();

    @Global()
    @Module({
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: issuer.verifier },
        { provide: DATABASE_POOL, useValue: {} },
        { provide: IdentityDatabase, useValue: {} },
        { provide: RateLimiter, useValue: limiter },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, DATABASE_POOL, IdentityDatabase, RateLimiter],
    })
    class FakePlatformModule {}

    @Module({ imports: [ApiConfigModule.forRoot(testConfig()), FakePlatformModule, PortGatewayModule.forRoot([shelf])] })
    class TestModule {}

    const app = await createApp(TestModule, testConfig());
    try {
      // No token: the manifest is public, listing is not access.
      const response = await app.inject({ method: 'GET', url: '/v1/ports' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ports: { shelf: ['echo', 'whoAmI', 'nothing', 'refuse', 'crash', 'needsStorage'] } });
    } finally {
      await app.close();
    }
  });
});
