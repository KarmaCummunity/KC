import { describe, expect, it } from 'vitest';
import { isPersistableQueryKey } from '../queryPersistKeys';
import { queryClient } from '../queryPersist';

describe('isPersistableQueryKey (#894)', () => {
  it('persists feed and profile roots', () => {
    expect(isPersistableQueryKey(['feed', 'home'])).toBe(true);
    expect(isPersistableQueryKey(['user-profile', 'uid'])).toBe(true);
    expect(isPersistableQueryKey(['profile-posts', 'uid'])).toBe(true);
    expect(isPersistableQueryKey(['chat-inbox'])).toBe(true);
    expect(isPersistableQueryKey(['universalSearch', '', {}])).toBe(true);
    expect(isPersistableQueryKey(['post', 'pid'])).toBe(true);
    expect(isPersistableQueryKey(['profile-closed-posts', 'uid'])).toBe(true);
  });

  it('skips volatile or sensitive keys', () => {
    expect(isPersistableQueryKey(['post-saved', 'pid'])).toBe(false);
    expect(isPersistableQueryKey(['admin-tasks'])).toBe(false);
    expect(isPersistableQueryKey([42])).toBe(false);
  });
});

describe('queryClient network and retry defaults', () => {
  it('configures offlineFirst for queries and always for mutations', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.networkMode).toBe('offlineFirst');
    expect(defaults.mutations?.networkMode).toBeUndefined();
  });

  it('disables mutation auto-retries for non-idempotent writes', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(0);
  });

  it('uses robust retry predicate and backoff for queries', () => {
    const defaults = queryClient.getDefaultOptions();
    const retryFn = defaults.queries?.retry;
    expect(typeof retryFn).toBe('function');
    if (typeof retryFn === 'function') {
      expect(retryFn(0, { status: 403 } as never)).toBe(false);
      expect(retryFn(0, new TypeError('Network request failed') as never)).toBe(true);
    }

    const delayFn = defaults.queries?.retryDelay;
    expect(typeof delayFn).toBe('function');
    if (typeof delayFn === 'function') {
      expect(delayFn(0, undefined as never)).toBe(1000);
      expect(delayFn(1, undefined as never)).toBe(2000);
    }
  });
});
