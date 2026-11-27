import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { APP_LOGGER, type AppLogger, appLoggerProvider } from '../logging/appLogger';
import { REDIS_CLIENT } from '../redis/redis.tokens';

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the caller may try again; 0 when allowed. */
  readonly retryAfterSeconds: number;
}

const WINDOW_SECONDS = 60;
const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Caps how many calls one caller makes per minute, counted in Redis so the
 * cap holds across every API instance.
 *
 * A fixed one-minute window: one counter per caller per minute, expired by
 * Redis. Simple and cheap (one round trip); a caller can spend two windows'
 * allowance across a boundary, which is acceptable for a cap whose job is to
 * stop runaway clients and scrapers, not to meter usage.
 */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    /** Clock in milliseconds, injected by tests. */
    private readonly now: () => number = Date.now,
  ) {}

  /** @param subject Who is counted: `user:<id>` for a member, `ip:<address>` for a visitor. */
  async check(subject: string): Promise<RateLimitDecision> {
    const limit = this.config.rateLimitPerMinute;
    if (limit === 0) return ALLOWED;

    const seconds = Math.floor(this.now() / 1000);
    const window = Math.floor(seconds / WINDOW_SECONDS);
    const key = `kc:rate:${subject}:${window}`;
    try {
      // The expiry outlives the window so a late increment never creates a key that lives forever.
      const results = await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS * 2).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (count <= limit) return ALLOWED;
      return { allowed: false, retryAfterSeconds: WINDOW_SECONDS - (seconds % WINDOW_SECONDS) };
    } catch (error) {
      // Redis being down must not take the API down with it: let the call through and say so.
      this.logger.warn({ err: error }, 'rate limiter unavailable; allowing the call');
      return ALLOWED;
    }
  }
}

@Global()
@Module({
  providers: [
    appLoggerProvider,
    {
      provide: RateLimiter,
      inject: [REDIS_CLIENT, API_CONFIG, APP_LOGGER],
      useFactory: (redis: Redis, config: ApiConfig, logger: AppLogger) => new RateLimiter(redis, config, logger),
    },
  ],
  exports: [RateLimiter],
})
export class RateLimitModule {}
