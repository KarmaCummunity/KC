import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../../__tests__/support/testConfig';
import type { AppLogger } from '../../logging/appLogger';
import { RateLimiter } from '../rateLimiter';

/** An in-memory stand-in for the two Redis commands the limiter sends in one transaction. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis = {
    failing: false,
    multi() {
      const queued: Array<() => [null, number]> = [];
      const chain = {
        incr(key: string) {
          queued.push(() => [null, counters.set(key, (counters.get(key) ?? 0) + 1).get(key) as number]);
          return chain;
        },
        expire(key: string, seconds: number) {
          queued.push(() => [null, expiries.set(key, seconds).size]);
          return chain;
        },
        exec: () => (redis.failing ? Promise.reject(new Error('connection refused')) : Promise.resolve(queued.map((run) => run()))),
      };
      return chain;
    },
  };
  return { redis, counters, expiries };
}

function setup(limit: number) {
  const { redis, counters, expiries } = fakeRedis();
  const warn = vi.fn();
  let clock = 1_800_000_020_000; // 20 seconds into a minute window (1 800 000 000 s is a whole number of minutes)
  const limiter = new RateLimiter(redis as unknown as Redis, testConfig({ rateLimitPerMinute: limit }), { warn } as unknown as AppLogger, () => clock);
  return { limiter, redis, counters, expiries, warn, advance: (ms: number) => (clock += ms) };
}

describe('RateLimiter', () => {
  it('allows calls up to the limit and refuses the next, saying how long to wait', async () => {
    const { limiter } = setup(3);

    const decisions = [];
    for (let call = 0; call < 4; call += 1) decisions.push(await limiter.check('user:a'));

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions[3]?.retryAfterSeconds).toBe(40);
  });

  it('counts each caller on their own', async () => {
    const { limiter } = setup(1);

    expect((await limiter.check('user:a')).allowed).toBe(true);
    expect((await limiter.check('user:b')).allowed).toBe(true);
    expect((await limiter.check('ip:203.0.113.7')).allowed).toBe(true);
    expect((await limiter.check('user:a')).allowed).toBe(false);
  });

  it('starts a fresh allowance in the next minute', async () => {
    const { limiter, advance } = setup(1);

    await limiter.check('user:a');
    expect((await limiter.check('user:a')).allowed).toBe(false);

    advance(40_000);
    expect((await limiter.check('user:a')).allowed).toBe(true);
  });

  it('lets every counter expire, so no key lives forever', async () => {
    const { limiter, counters, expiries } = setup(5);

    await limiter.check('user:a');

    expect([...expiries.keys()]).toEqual([...counters.keys()]);
    expect([...expiries.values()]).toEqual([120]);
  });

  it('does not touch Redis when the limit is switched off', async () => {
    const { limiter, counters } = setup(0);

    expect(await limiter.check('user:a')).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(counters.size).toBe(0);
  });

  it('lets calls through and warns when Redis is down', async () => {
    const { limiter, redis, warn } = setup(1);
    redis.failing = true;

    expect((await limiter.check('user:a')).allowed).toBe(true);
    expect((await limiter.check('user:a')).allowed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });
  describe('on a server that runs without Redis', () => {
    function setupLocal(limit: number) {
      let clock = 1_800_000_020_000;
      const limiter = new RateLimiter(null, testConfig({ rateLimitPerMinute: limit }), { warn: vi.fn() } as unknown as AppLogger, () => clock);
      return { limiter, advance: (ms: number) => (clock += ms) };
    }

    it('counts in the process: up to the limit, then refused with the wait, each caller on their own', async () => {
      const { limiter } = setupLocal(2);

      const decisions = [];
      for (let call = 0; call < 3; call += 1) decisions.push(await limiter.check('user:a'));

      expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, false]);
      expect(decisions[2]?.retryAfterSeconds).toBe(40);
      expect((await limiter.check('user:b')).allowed).toBe(true);
    });

    it('starts a fresh allowance in the next minute', async () => {
      const { limiter, advance } = setupLocal(1);
      await limiter.check('user:a');
      expect((await limiter.check('user:a')).allowed).toBe(false);

      advance(40_000);

      expect((await limiter.check('user:a')).allowed).toBe(true);
    });

    it('allows every call when the limit is switched off', async () => {
      const { limiter } = setupLocal(0);

      expect((await limiter.check('user:a')).allowed).toBe(true);
    });
  });
});
