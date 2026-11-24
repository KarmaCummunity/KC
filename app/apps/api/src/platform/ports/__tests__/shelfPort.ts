import { CALLER_FILES, type CallerFiles } from '../callerFiles';
import type { InProcessStorage } from '../../postgrest/sqlBackedClient';
import type { ApiConfig } from '../../config/apiConfig';
import { FollowError } from '@kc/application';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { testConfig } from '../../../__tests__/support/testConfig';
import { createTestIssuer, type TestIssuer } from '../../../__tests__/support/testTokens';
import { createApp } from '../../../createApp';
import { ApiConfigModule } from '../../config/apiConfig.module';
import { DATABASE_POOL } from '../../database/database.tokens';
import { IdentityDatabase } from '../../database/identityDatabase';
import { ACCESS_TOKEN_VERIFIER } from '../../identity/accessTokenVerifier';
import type { SqlBackedClient } from '../../postgrest/sqlBackedClient';
import { RateLimiter } from '../../rateLimit/rateLimiter';
import { definePort } from '../portDefinition';
import { PortClientsModule } from '../portClients.module';
import { PortGatewayModule } from '../portGateway.module';
import { type CachedResult, VisitorCache } from '../visitorCache';

// Fixture of the gateway's HTTP tests: one port with a method of each kind the
// gateway must handle, in-memory stand-ins for the Redis services, and an app
// that serves them with a local token issuer.

/** A port with one method of each kind the gateway must handle. */
export interface Shelf {
  echo(first: string, second?: number, third?: string): Promise<unknown>;
  whoAmI(): Promise<string | null>;
  nothing(): Promise<void>;
  refuse(): Promise<never>;
  crash(): Promise<never>;
  needsStorage(): Promise<unknown>;
  upload(): Promise<void>;
  /** Reads a stored file's address: served only where the server has a file store. */
  filed(path: string): Promise<string>;
  /** Counts how often it really ran, to observe the visitor cache. */
  counted(key: string): Promise<number>;
  countedNothing(): Promise<void>;
  countedRefusal(): Promise<never>;
}

/** How many times each counted method ran; reset per test. */
export const runs = { counted: 0, countedNothing: 0, countedRefusal: 0 };

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
  filed(path: string) {
    const { storage } = this.client as unknown as { storage: InProcessStorage };
    return Promise.resolve(storage.from('shelf-files').getPublicUrl(path).data.publicUrl);
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

export const shelf = definePort<Shelf>({
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
    filed: 'member_with_files',
    counted: 'public',
    countedNothing: 'public',
    countedRefusal: 'public',
  },
  visitorCacheSeconds: { counted: 30, countedNothing: 30, countedRefusal: 30 },
});

/** An in-memory visitor cache with the same contract as the Redis one. */
export const visitorCache = {
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
export const limiter = {
  blocked: false,
  subjects: [] as string[],
  check(subject: string) {
    this.subjects.push(subject);
    return Promise.resolve(this.blocked ? { allowed: false, retryAfterSeconds: 42 } : { allowed: true, retryAfterSeconds: 0 });
  },
};

/**
 * A double under a real catalog name, so the gateway checks its arguments
 * against the shapes generated from `ISavedPostsRepository`.
 */
export const savedPostsDouble = definePort<{ savePost(postId: string): Promise<string>; listSavedPosts(limit: number, cursor?: string): Promise<unknown> }>({
  name: 'savedPosts',
  create: () => ({
    savePost: (postId) => Promise.resolve(`saved ${postId}`),
    listSavedPosts: (limit, cursor) => Promise.resolve({ limit, cursor: cursor ?? null }),
  }),
  methods: { savePost: 'member', listSavedPosts: 'member' },
});

/**
 * A double under the catalog name of a port that carries dates
 * (`ILegalDocumentRepository`), to observe the gateway's date handling.
 */
export const legalDocumentDouble = definePort<{
  getCurrentContent(docType: string): Promise<unknown>;
  acceptVersion(input: Record<string, unknown>): Promise<unknown>;
}>({
  name: 'legalDocument',
  create: () => ({
    getCurrentContent: (docType) => Promise.resolve({ docType, effectiveDate: new Date('2026-01-01T00:00:00.000Z') }),
    // Reports what it received, so a test can see whether a marked date arrived as a Date.
    acceptVersion: (input) => Promise.resolve({ acceptedAt: new Date('2026-11-21T10:00:00.000Z'), sawDate: input.at instanceof Date }),
  }),
  methods: { getCurrentContent: 'public', acceptVersion: 'member' },
  visitorCacheSeconds: { getCurrentContent: 30 },
});

/** Puts the fakes back to their initial state; call before each test. */
export function resetShelf(): void {
  limiter.blocked = false;
  limiter.subjects = [];
  visitorCache.entries.clear();
  visitorCache.lifetimes = [];
  runs.counted = runs.countedNothing = runs.countedRefusal = 0;
}

/** An app that serves the shelf port. The shelf never queries, so the database behind it is inert. */
/** @param files The server's file store for hosted adapters; omitted: a server without one. */
export async function createShelfApp(overrides: Partial<ApiConfig> = {}, files?: CallerFiles): Promise<{ app: NestFastifyApplication; issuer: TestIssuer }> {
  const config = testConfig(overrides);
  const issuer = await createTestIssuer();

  @Global()
  @Module({
    providers: [
      { provide: ACCESS_TOKEN_VERIFIER, useValue: issuer.verifier },
      { provide: DATABASE_POOL, useValue: {} },
      { provide: IdentityDatabase, useValue: {} },
      { provide: RateLimiter, useValue: limiter },
      { provide: VisitorCache, useValue: visitorCache },
      ...(files ? [{ provide: CALLER_FILES, useValue: files }] : []),
    ],
    exports: [ACCESS_TOKEN_VERIFIER, DATABASE_POOL, IdentityDatabase, RateLimiter, VisitorCache, ...(files ? [CALLER_FILES] : [])],
  })
  class FakePlatformModule {}

  @Module({
    imports: [ApiConfigModule.forRoot(config), FakePlatformModule, PortClientsModule, PortGatewayModule.forRoot([shelf, savedPostsDouble, legalDocumentDouble])],
  })
  class TestModule {}

  return { app: await createApp(TestModule, config), issuer };
}

/** Calls a shelf method over HTTP; `authorization: null` is a signed-out visitor. */
export function callShelf(app: NestFastifyApplication, path: string, args: unknown, authorization: string | null) {
  return app.inject({
    method: 'POST',
    url: `/v1/ports/${path}`,
    payload: { args },
    headers: authorization ? { authorization } : {},
  });
}
