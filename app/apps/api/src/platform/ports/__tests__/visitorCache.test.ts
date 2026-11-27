import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../../logging/appLogger';
import { VisitorCache } from '../visitorCache';

function setup() {
  const store = new Map<string, { value: string; seconds: number }>();
  const redis = {
    failing: false,
    get: (key: string) => (redis.failing ? Promise.reject(new Error('down')) : Promise.resolve(store.get(key)?.value ?? null)),
    set: (key: string, value: string, _mode: string, seconds: number) => {
      if (redis.failing) return Promise.reject(new Error('down'));
      store.set(key, { value, seconds });
      return Promise.resolve('OK');
    },
  };
  const warn = vi.fn();
  return { cache: new VisitorCache(redis as unknown as Redis, { warn } as unknown as AppLogger), redis, store, warn };
}

describe('VisitorCache', () => {
  it('returns what was stored for the same call, with its lifetime set', async () => {
    const { cache, store } = setup();

    await cache.write('guestPosts', 'list', ['cursor'], [{ id: 1 }], 15);

    expect(await cache.read('guestPosts', 'list', ['cursor'])).toEqual({ found: true, value: [{ id: 1 }] });
    expect([...store.values()][0]?.seconds).toBe(15);
  });

  it('keeps calls with different arguments, methods or ports apart', async () => {
    const { cache } = setup();
    await cache.write('guestPosts', 'list', ['a'], 'A', 15);

    expect(await cache.read('guestPosts', 'list', ['b'])).toEqual({ found: false });
    expect(await cache.read('guestPosts', 'get', ['a'])).toEqual({ found: false });
    expect(await cache.read('stats', 'list', ['a'])).toEqual({ found: false });
  });

  it('tells a stored null or nothing from a miss', async () => {
    const { cache } = setup();
    await cache.write('guestPosts', 'get', ['missing'], null, 15);
    await cache.write('guestPosts', 'ping', [], undefined, 15);

    expect(await cache.read('guestPosts', 'get', ['missing'])).toEqual({ found: true, value: null });
    expect(await cache.read('guestPosts', 'ping', [])).toEqual({ found: true, value: undefined });
  });

  it('uses fixed-length keys that never contain the arguments', async () => {
    const { cache, store } = setup();

    await cache.write('guestPosts', 'get', ['a very long argument '.repeat(50)], 1, 15);

    const [key] = [...store.keys()];
    expect(key).toMatch(/^kc:visitor:guestPosts\.get:[A-Za-z0-9_-]{43}$/);
  });

  it('is a miss and a no-op when Redis is down', async () => {
    const { cache, redis, warn } = setup();
    redis.failing = true;

    await cache.write('guestPosts', 'list', [], 'x', 15);

    expect(await cache.read('guestPosts', 'list', [])).toEqual({ found: false });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
