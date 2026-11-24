import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabasePostRepository } from '../SupabasePostRepository';
import { makeCard, ok, pageTables } from './cardFixtures';

// #1763: nearest pages must use the cards and distances from the same RPC,
// rather than re-reading posts by the ranked ids returned by an older RPC.
describe('SupabasePostRepository nearest feed round-trips', () => {
  it('keeps server order, distances, filters and the cursor without a posts read', async () => {
    const rows = [
      { card: makeCard({ id: 'z-near' }), distance_m: 125, next_cursor: { id: 'z-near', d: 125 } },
      { card: makeCard({ id: 'a-far' }), distance_m: 2500, next_cursor: { id: 'a-far', d: 2500 } },
    ];
    const { client, calls } = createFakeClient({ tables: pageTables(), rpc: { feed_page: ok(rows) } });
    const cursor = { id: 'previous', d: 100 };

    const page = await new SupabasePostRepository(client).getFeed('viewer', {
      type: 'Give', sortOrder: 'distance', proximitySortCity: 'IL-001',
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: 10 },
    }, 2, JSON.stringify(cursor));

    expect(calls.filter((call) => call.kind === 'rpc').map((call) => call.fn)).toEqual(['feed_page']);
    expect(callsTo(calls, 'feed_page')[0]?.args).toEqual({
      p_cursor: cursor, p_limit: 2,
      p_filters: { sort: 'nearest', direction: 'offer', city_id: 'IL-001', radius_km: 10, near_city_id: 'IL-001' },
    });
    expect(callsTo(calls, 'posts')).toHaveLength(0);
    expect(page.posts.map((post) => [post.postId, post.distanceKm])).toEqual([
      ['z-near', 0.125], ['a-far', 2.5],
    ]);
    expect(page.nextCursor).toBe(JSON.stringify(rows[1]?.next_cursor));
  });

  it('ends an empty nearest page without a fallback query for post ids', async () => {
    const { client, calls } = createFakeClient({ tables: pageTables(), rpc: { feed_page: ok([]) } });

    const page = await new SupabasePostRepository(client).getFeed(null, {
      sortOrder: 'distance', proximitySortCity: 'IL-001',
    }, 20);

    expect(page).toEqual({ posts: [], nextCursor: null });
    expect(calls.filter((call) => call.kind === 'rpc').map((call) => call.fn)).toEqual(['feed_page']);
    expect(callsTo(calls, 'posts')).toHaveLength(0);
  });
});
