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
import { DuplicatePortError, indexPorts, PortGatewayModule, VisitorCacheOnPrivateMethodError } from '../portGateway.module';
import { type CachedResult, VisitorCache } from '../visitorCache';

/** A port with one method of each kind the gateway must handle. */
interface Shelf {
  echo(first: string, second?: number, third?: string): Promise<unknown>;
  whoAmI(): Promise<string | null>;
  nothing(): Promise<void>;
  refuse(): Promise<never>;
  crash(): Promise<never>;
  needsStorage(): Promise<unknown>;
  upload(): Promise<void>;
  /** Counts how often it really ran, to observe the visitor cache. */
  counted(key: string): Promise<number>;
  countedNothing(): Promise<void>;
  countedRefusal(): Promise<never>;
}

/** How many times each counted method ran; reset per test. */
const runs = { counted: 0, countedNothing: 0, countedRefusal: 0 };

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
  counted() {
    runs.counted += 1;
    return Promise.resolve(runs.counted);
  }
  countedNothing() {
    runs.countedNothing += 1;
    return Promise.resolve();
  }
  countedRefusal(): Promise<never> {
    runs.countedRefusal += 1;
    return Promise.reject(new FollowError('cooldown_active', 'wait'));
  }
}

const shelf = definePort<Shelf>({
  name: 'shelf',
  create: (client) => new ShelfImplementation(client),
  methods: {
    echo: 'member',
    whoAmI: 'public',
    nothing: 'member',
    refuse: 'member',
    crash: 'member',
    needsStorage: 'member',
    upload: 'not_served',
    counted: 'public',
    countedNothing: 'public',
    countedRefusal: 'public',
  },
  visitorCacheSeconds: { counted: 30, countedNothing: 30, countedRefusal: 30 },
});

/** An in-memory visitor cache with the same contract as the Redis one. */
const visitorCache = {
  entries: new Map<string, unknown>(),
  lifetimes: [] as number[],
  read(port: string, method: string, args: readonly unknown[]): Promise<CachedResult> {
    const key = `${port}.${method}:${JSON.stringify(args)}`;
    return Promise.resolve(this.entries.has(key) ? { found: true, value: this.entries.get(key) } : { found: false });
  },
  write(port: string, method: string, args: readonly unknown[], value: unknown, seconds: number): Promise<void> {
    this.entries.set(`${port}.${method}:${JSON.stringify(args)}`, value);
    this.lifetimes.push(seconds);
    return Promise.resolve();
  },
};

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
        { provide: VisitorCache, useValue: visitorCache },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, DATABASE_POOL, IdentityDatabase, RateLimiter, VisitorCache],
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
    visitorCache.entries.clear();
    visitorCache.lifetimes = [];
    runs.counted = runs.countedNothing = runs.countedRefusal = 0;
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

  it('answers visitors from the cache: one run serves every visitor who asks the same thing', async () => {
    const first = await call('shelf/counted', ['a'], null);
    const second = await call('shelf/counted', ['a'], null);
    const other = await call('shelf/counted', ['b'], null);

    expect([first.json(), second.json(), other.json()]).toEqual([{ result: 1 }, { result: 1 }, { result: 2 }]);
    expect(runs.counted).toBe(2);
    expect(visitorCache.lifetimes).toEqual([30, 30]);
  });

  it('never answers a member from the cache, and never stores a member\'s answer', async () => {
    await call('shelf/counted', ['a'], null);

    const asMember = await call('shelf/counted', ['a']);
    const asVisitorAgain = await call('shelf/counted', ['a'], null);

    expect(asMember.json()).toEqual({ result: 2 });
    expect(asVisitorAgain.json()).toEqual({ result: 1 });
    expect(visitorCache.entries.size).toBe(1);
  });

  it('caches a result of nothing as nothing, not as a miss', async () => {
    const first = await call('shelf/countedNothing', [], null);
    const second = await call('shelf/countedNothing', [], null);

    expect([first.json(), second.json()]).toEqual([{}, {}]);
    expect(runs.countedNothing).toBe(1);
  });

  it('does not cache a refusal', async () => {
    await call('shelf/countedRefusal', [], null);
    await call('shelf/countedRefusal', [], null);

    expect(runs.countedRefusal).toBe(2);
    expect(visitorCache.entries.size).toBe(0);
  });

  it('still counts a cached answer against the visitor\'s rate limit', async () => {
    await call('shelf/counted', ['a'], null);
    await call('shelf/counted', ['a'], null);

    expect(limiter.subjects).toEqual(['ip:127.0.0.1', 'ip:127.0.0.1']);
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

  it('refuses at start-up a visitor cache on a method visitors cannot call', () => {
    const leaky = { ...shelf, name: 'leaky', visitorCacheSeconds: { echo: 30 } };

    expect(() => indexPorts([leaky])).toThrow(VisitorCacheOnPrivateMethodError);
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
        { provide: VisitorCache, useValue: visitorCache },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, DATABASE_POOL, IdentityDatabase, RateLimiter, VisitorCache],
    })
    class FakePlatformModule {}

    @Module({ imports: [ApiConfigModule.forRoot(testConfig()), FakePlatformModule, PortGatewayModule.forRoot([shelf])] })
    class TestModule {}

    const app = await createApp(TestModule, testConfig());
    try {
      // No token: the manifest is public, listing is not access.
      const response = await app.inject({ method: 'GET', url: '/v1/ports' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ports: { shelf: ['echo', 'whoAmI', 'nothing', 'refuse', 'crash', 'needsStorage', 'counted', 'countedNothing', 'countedRefusal'] },
      });
    } finally {
      await app.close();
    }
  });
});
