import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import {
  clampPageLimit,
  fetchFeedPage,
  fetchPostsByIds,
  fetchProfileTabPage,
  fetchSearchPage,
} from '../postCardPages';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

const row = (id: string, cursor: object, distance?: number) => ({
  card: makeCard({ id }),
  next_cursor: cursor,
  distance_m: distance,
});

describe('clampPageLimit', () => {
  it('keeps the limit inside what the baseline honours', () => {
    expect(clampPageLimit(0)).toBe(1);
    expect(clampPageLimit(20)).toBe(20);
    expect(clampPageLimit(500)).toBe(50);
  });
});

describe('fetchFeedPage', () => {
  it('sends the filters, the clamped limit and the decoded cursor, and maps the cards', async () => {
    const { client, calls } = createFakeClient({
      tables: pageTables(),
      rpc: { feed_page: ok([row('post-1', { t: 1 }, 1500), row('post-2', { t: 2 })]) },
    });

    const page = await fetchFeedPage(client, { sort: 'nearest' }, 2, JSON.stringify({ t: 0 }));

    expect(callsTo(calls, 'feed_page')[0]?.args).toEqual({
      p_cursor: { t: 0 },
      p_limit: 2,
      p_filters: { sort: 'nearest' },
    });
    expect(page.posts.map((post) => post.postId)).toEqual(['post-1', 'post-2']);
    expect(page.posts[0]?.distanceKm).toBe(1.5);
    expect(page.nextCursor).toBe(JSON.stringify({ t: 2 }));
  });

  it('has no next cursor on a short page', async () => {
    const { client } = createFakeClient({
      tables: pageTables(),
      rpc: { feed_page: ok([row('post-1', { t: 1 })]) },
    });

    expect((await fetchFeedPage(client, {}, 20)).nextCursor).toBeNull();
  });

  it('maps a signed-out refusal to a rule error and a missing function to unavailable', async () => {
    const refused = createFakeClient({ rpc: { feed_page: fail('42501', 'unauthenticated') } });
    await expect(fetchFeedPage(refused.client, {}, 20)).rejects.toBeInstanceOf(BackendRuleError);

    const missing = createFakeClient({ rpc: { feed_page: fail('PGRST202', 'no function') } });
    await expect(fetchFeedPage(missing.client, {}, 20)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('fetchSearchPage / fetchProfileTabPage', () => {
  it('passes the query and the filters of a post search', async () => {
    const { client, calls } = createFakeClient({
      tables: pageTables(),
      rpc: { search_posts_page: ok([row('post-1', { t: 1 })]) },
    });

    await fetchSearchPage(client, 'sofa', { city_id: 'IL-001' }, 10);

    expect(callsTo(calls, 'search_posts_page')[0]?.args).toEqual({
      p_query: 'sofa',
      p_cursor: undefined,
      p_limit: 10,
      p_filters: { city_id: 'IL-001' },
    });
  });

  it('asks for one tab of a profile', async () => {
    const { client, calls } = createFakeClient({
      tables: pageTables(),
      rpc: { profile_posts_page: ok([row('post-1', { t: 1, id: 'post-1' })]) },
    });

    const page = await fetchProfileTabPage(client, 'u1', 'closed', 30);

    expect(callsTo(calls, 'profile_posts_page')[0]?.args).toMatchObject({ p_user_id: 'u1', p_tab: 'closed', p_limit: 30 });
    expect(page.posts).toHaveLength(1);
  });
});

describe('fetchPostsByIds', () => {
  it('returns the posts in the order of the ids and drops the ones the caller cannot read', async () => {
    const { client, calls } = createFakeClient({
      tables: pageTables(),
      rpc: { post_cards: ok([makeCard({ id: 'b' }), makeCard({ id: 'a' })]) },
    });

    const posts = await fetchPostsByIds(client, ['a', 'hidden', 'b']);

    expect(posts.map((post) => post.postId)).toEqual(['a', 'b']);
    expect(callsTo(calls, 'post_cards')[0]?.args).toEqual({ p_post_ids: ['a', 'hidden', 'b'] });
  });

  it('does not call the server for no ids', async () => {
    const { client, calls } = createFakeClient();
    expect(await fetchPostsByIds(client, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
