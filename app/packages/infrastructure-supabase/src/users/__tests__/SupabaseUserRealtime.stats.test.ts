import { describe, it, expect, vi } from 'vitest';
import { flush, makeFakeRealtime } from '../../realtime/__tests__/fakeRealtime';
import { SupabaseUserRealtime, parseStatsChange } from '../SupabaseUserRealtime';

const PAYLOAD = {
  karma_points: 12,
  followers_count: 3,
  following_count: 4,
  items_given_count: 2,
  items_received_count: 1,
  posts_created_total: 9,
  open_posts_count: 5,
};

const CHANGE = {
  karmaPoints: 12,
  followersCount: 3,
  followingCount: 4,
  itemsGivenCount: 2,
  itemsReceivedCount: 1,
  postsCreatedTotal: 9,
  openPostsCount: 5,
};

describe('parseStatsChange', () => {
  it('reads every counter of the payload', () => {
    expect(parseStatsChange(PAYLOAD)).toEqual(CHANGE);
  });

  it.each([[null], [{}], [{ ...PAYLOAD, karma_points: '12' }], [{ ...PAYLOAD, open_posts_count: undefined }]])(
    'rejects a payload with a missing or non-numeric counter: %j',
    (payload) => {
      expect(parseStatsChange(payload)).toBeNull();
    },
  );
});

describe('SupabaseUserRealtime.subscribeToStats (FR-KARMA-009)', () => {
  it('joins the private topic user:<id>:stats and hands stats_changed counters to the listener', async () => {
    const f = makeFakeRealtime();
    const onChange = vi.fn();
    const unsubscribe = new SupabaseUserRealtime(f.client).subscribeToStats('u1', onChange);
    await flush();

    expect(f.channel).toHaveBeenCalledWith('user:u1:stats', { config: { private: true } });
    f.created[0]!.emit('broadcast', 'stats_changed', { payload: PAYLOAD });
    f.created[0]!.emit('broadcast', 'stats_changed', { payload: { karma_points: 1 } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(CHANGE);

    unsubscribe();
    expect(f.created[0]!.removed).toBe(true);
  });

  it('reports a dropped channel', async () => {
    const f = makeFakeRealtime();
    const onError = vi.fn();
    new SupabaseUserRealtime(f.client).subscribeToStats('u1', vi.fn(), onError);
    await flush();
    f.created[0]!.statusCb!('TIMED_OUT');
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('stats channel timed_out');
  });
});
