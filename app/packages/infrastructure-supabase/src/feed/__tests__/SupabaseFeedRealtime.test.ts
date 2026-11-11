import { describe, it, expect, vi } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { FEED_PUBLIC_TOPIC, SupabaseFeedRealtime } from '../SupabaseFeedRealtime';

describe('SupabaseFeedRealtime (degraded: the baseline has no feed topic, M24)', () => {
  it('reports BackendUnavailableError for the missing topic through onError', () => {
    const onError = vi.fn();

    new SupabaseFeedRealtime().subscribeToPublicInserts({ onNewPublicPost: vi.fn(), onError });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]![0] as BackendUnavailableError;
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error.object).toBe(`channel:${FEED_PUBLIC_TOPIC}`);
  });

  it('never delivers a post and hands back a harmless unsubscribe', () => {
    const onNewPublicPost = vi.fn();

    const unsubscribe = new SupabaseFeedRealtime().subscribeToPublicInserts({ onNewPublicPost });

    expect(() => unsubscribe()).not.toThrow();
    expect(onNewPublicPost).not.toHaveBeenCalled();
  });
});
