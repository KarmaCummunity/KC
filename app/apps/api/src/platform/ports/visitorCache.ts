import { createHash } from 'node:crypto';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_LOGGER, type AppLogger, appLoggerProvider } from '../logging/appLogger';
import { REDIS_CLIENT } from '../redis/redis.tokens';

/** A cached port result. `found: false` means "not cached", which is different from a cached `null`. */
export type CachedResult = { readonly found: true; readonly value: unknown } | { readonly found: false };

const MISS: CachedResult = { found: false };

/**
 * Short-lived cache, in Redis, of the answers signed-out visitors get from
 * `public` port methods. All visitors share one database role, so one
 * answer serves them all and a burst of visitors (a shared link, a landing
 * page) costs one query instead of one per request.
 *
 * Only successful results are stored. Redis being down, or a server that
 * runs without it, turns the cache off: a read is a miss and a write is
 * dropped.
 */
@Injectable()
export class VisitorCache {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** One key per call shape; the arguments are hashed so a key has a fixed, safe length. */
  private key(port: string, method: string, args: readonly unknown[]): string {
    const digest = createHash('sha256').update(JSON.stringify(args)).digest('base64url');
    return `kc:visitor:${port}.${method}:${digest}`;
  }

  async read(port: string, method: string, args: readonly unknown[]): Promise<CachedResult> {
    if (this.redis === null) return MISS;
    try {
      const stored = await this.redis.get(this.key(port, method, args));
      if (stored === null) return MISS;
      // `undefined` cannot be stored as JSON; it is kept as an envelope without a value.
      return { found: true, value: (JSON.parse(stored) as { value?: unknown }).value };
    } catch (error) {
      this.logger.warn({ err: error }, 'visitor cache unavailable; running the call');
      return MISS;
    }
  }

  async write(port: string, method: string, args: readonly unknown[], value: unknown, seconds: number): Promise<void> {
    if (this.redis === null) return;
    try {
      await this.redis.set(this.key(port, method, args), JSON.stringify({ value }), 'EX', seconds);
    } catch (error) {
      this.logger.warn({ err: error }, 'visitor cache unavailable; result not stored');
    }
  }
}

@Global()
@Module({ providers: [appLoggerProvider, VisitorCache], exports: [VisitorCache] })
export class VisitorCacheModule {}
