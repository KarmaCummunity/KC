import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppLogger } from '../platform/logging/appLogger';
import { RateLimiter } from '../platform/rateLimit/rateLimiter';
import { testConfig } from './support/testConfig';

const { REDIS_URL } = process.env;

/** The limiter against a real Redis: the transaction it sends and the expiry it sets. */
describe.skipIf(!REDIS_URL)('RateLimiter on Redis', () => {
  let redis: Redis;
  const subject = `user:test-${Date.now()}`;
  const silent = { warn: () => undefined } as unknown as AppLogger;

  beforeAll(() => {
    redis = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    const keys = await redis.keys(`kc:rate:${subject}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it('counts across limiter instances, as across API instances, and expires its counter', async () => {
    const config = testConfig({ rateLimitPerMinute: 2 });
    // Pin the clock inside one window so the test cannot straddle a minute boundary.
    const now = () => 1_800_000_020_000;
    const first = new RateLimiter(redis, config, silent, now);
    const second = new RateLimiter(redis, config, silent, now);

    const allowed = [await first.check(subject), await second.check(subject), await first.check(subject)].map((d) => d.allowed);
    const [key] = await redis.keys(`kc:rate:${subject}:*`);
    const ttl = await redis.ttl(key ?? '');

    expect(allowed).toEqual([true, true, false]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});
