import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, type SearchFilters } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, makeCard, ok, pageTables } from '../../posts/__tests__/cardFixtures';
import { SupabaseSearchRepository } from '../SupabaseSearchRepository';

const LIMITS = { posts: 2, users: 2, links: 2 };

const userRow = (id: string) => ({
  id, share_handle: id, display_name: `User ${id}`, biography: 'bio', avatar_url: null, city_id: 'IL-001',
  privacy_mode: 'Public', privacy_changed_at: null, verification_level: 1, preferred_language: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const statsRow = (id: string, followers: number) => ({
  user_id: id, followers_count: followers, following_count: 0, items_given_count: 4, items_received_count: 0,
  open_posts_public: 0, open_posts_followers_only: 0,
});
const linkRow = (id: string) => ({
  id, category_slug: 'food', url: `https://x/${id}`, display_name: `Link ${id}`, description: null,
});

function setup(config: FakeClientConfig = {}) {
  return createFakeClient({
    userId: 'viewer',
    ...config,
    tables: {
      ...pageTables(),
      cities: ok([{ city_id: 'IL-001', name_he: 'Tel Aviv' }]),
      user_stats: ok([statsRow('u1', 9), statsRow('u2', 5)]),
      donation_links: ok([linkRow('l1')]),
      ...config.tables,
    },
  });
}

const query = (calls: FakeCall[], table: string) => callsTo(calls, table)[0];

describe('SupabaseSearchRepository — text query', () => {
  it('searches posts, members and links in parallel and reports has-more', async () => {
    const { client, calls } = setup({
      tables: {
        users: ok([userRow('u2'), userRow('u1')]),
        donation_links: ok([linkRow('l1'), linkRow('l2'), linkRow('l3')]),
      },
      rpc: {
        search_posts_page: ok([
          { card: makeCard({ id: 'a' }), next_cursor: {} },
          { card: makeCard({ id: 'b' }), next_cursor: {} },
          { card: makeCard({ id: 'c' }), next_cursor: {} },
        ]),
        search_users_page: ok([{ id: 'u1' }, { id: 'u2' }]),
      },
    });

    const result = await new SupabaseSearchRepository(client).search('sofa', {}, 'viewer', LIMITS);

    expect(result.posts.map((p) => p.postId)).toEqual(['a', 'b']);
    expect(result.postsHasMore).toBe(true);
    expect(result.users.map((u) => [u.userId, u.followersCount, u.itemsGivenCount, u.cityName])).toEqual([
      ['u1', 9, 4, 'Tel Aviv'],
      ['u2', 5, 4, 'Tel Aviv'],
    ]);
    expect(result.usersHasMore).toBe(false);
    expect(result.links.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(result.linksHasMore).toBe(true);
    expect(callsTo(calls, 'search_posts_page')[0]?.args).toMatchObject({ p_query: 'sofa', p_limit: 3 });
  });

  it('has no organizations, hashtags or suggested queries (M05)', async () => {
    const { client } = setup({ rpc: { search_posts_page: ok([]), search_users_page: ok([]) } });

    const result = await new SupabaseSearchRepository(client).search('sofa', {}, null, LIMITS);

    expect(result).toMatchObject({ orgs: [], hashtags: [], suggestedQueries: [], orgsTotal: 0, hashtagsTotal: 0 });
  });

  it('turns the filters into the keys of the feed', async () => {
    const { client, calls } = setup({ rpc: { search_posts_page: ok([]), search_users_page: ok([]) } });
    const filters: SearchFilters = {
      resultType: 'post', postType: 'Request', category: 'Books', city: 'IL-001', radiusKm: 10,
    };

    await new SupabaseSearchRepository(client).search('book', filters, null, LIMITS);

    expect(callsTo(calls, 'search_posts_page')[0]?.args).toMatchObject({
      p_filters: { direction: 'request', item_subcategory_ids: ['sub-books'], city_id: 'IL-001', radius_km: 10 },
    });
    expect(callsTo(calls, 'search_users_page')).toHaveLength(0);
  });

  it('filters members by city and followers, and links by category', async () => {
    const { client, calls } = setup({
      tables: { users: ok([]) },
      rpc: { search_users_page: ok([]) },
    });

    await new SupabaseSearchRepository(client).search(
      'dana',
      { resultType: 'user', city: 'IL-001', minFollowers: 3 },
      null,
      LIMITS,
    );
    expect(callsTo(calls, 'search_users_page')[0]?.args).toMatchObject({
      p_filters: { city_id: 'IL-001', min_followers: 3 },
    });

    const links = setup();
    await new SupabaseSearchRepository(links.client).search(
      'help',
      { resultType: 'link', donationCategory: 'food' },
      null,
      LIMITS,
    );
    const read = query(links.calls, 'donation_links');
    expect(read?.filters).toEqual(expect.arrayContaining([['eq', 'review_status', 'approved'], ['eq', 'category_slug', 'food']]));
  });

  it('reports a missing search function as unavailable', async () => {
    const { client } = setup({ rpc: { search_posts_page: fail('PGRST202', 'not found'), search_users_page: ok([]) } });
    await expect(new SupabaseSearchRepository(client).search('sofa', { resultType: 'post' }, null, LIMITS)).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('SupabaseSearchRepository — explore (no query)', () => {
  it('lists open posts of every world in search scope, newest first', async () => {
    const { client, calls } = setup({
      rpc: { feed_page: ok([{ card: makeCard({ id: 'a' }), next_cursor: {} }]) },
    });

    const result = await new SupabaseSearchRepository(client).search('  ', { resultType: 'post', city: 'IL-001' }, null, LIMITS);

    expect(callsTo(calls, 'feed_page')[0]?.args).toMatchObject({
      p_filters: { scope: 'search', sort: 'newest', status: 'open', city_id: 'IL-001' },
    });
    expect(result.posts.map((p) => p.postId)).toEqual(['a']);
  });

  it('lists the most followed members first', async () => {
    const { client, calls } = setup({ tables: { users: ok([userRow('u2'), userRow('u1')]) } });

    const result = await new SupabaseSearchRepository(client).search('', { resultType: 'user', minFollowers: 2 }, null, LIMITS);

    const stats = query(calls, 'user_stats');
    expect(stats?.filters).toEqual(expect.arrayContaining([['gte', 'followers_count', 2], ['limit', 3]]));
    expect(result.users.map((u) => u.userId)).toEqual(['u1', 'u2']);
  });

  it('considers only the members of the chosen city', async () => {
    const { client, calls } = setup({ tables: { users: ok([userRow('u1')]) } });

    await new SupabaseSearchRepository(client).search('', { resultType: 'user', city: 'IL-001' }, null, LIMITS);

    expect(callsTo(calls, 'users')[0]?.filters).toContainEqual(['eq', 'city_id', 'IL-001']);
  });

  it('lists the newest approved links', async () => {
    const { client, calls } = setup();

    const result = await new SupabaseSearchRepository(client).search('', { resultType: 'link' }, null, LIMITS);

    expect(query(calls, 'donation_links')?.filters).toContainEqual(['eq', 'review_status', 'approved']);
    expect(result.links[0]).toMatchObject({ id: 'l1', categorySlug: 'food', tags: null });
  });
});
