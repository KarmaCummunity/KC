import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { SupabaseStatsRepository } from '../SupabaseStatsRepository';

const ok = (data: unknown): FakeResult => ({ data, error: null });

const COMMUNITY = {
  registered_users: 12,
  open_public_posts: 7,
  delivered_posts: 31,
  refreshed_at: '2026-01-01T00:00:00Z',
};

describe('getCommunityStatsSnapshot', () => {
  it('reads the one row of community_stats()', async () => {
    const { client } = createFakeClient({ rpc: { community_stats: ok([COMMUNITY]) } });

    const snapshot = await new SupabaseStatsRepository(client).getCommunityStatsSnapshot();

    expect(snapshot).toEqual({
      registeredUsers: 12,
      activePublicPosts: 7,
      itemsDeliveredTotal: 31,
      asOf: '2026-01-01T00:00:00Z',
    });
  });

  it('is zero before the first refresh, and the active count is the open public posts', async () => {
    const { client } = createFakeClient({ rpc: { community_stats: ok([]) } });
    const repo = new SupabaseStatsRepository(client);

    expect(await repo.getCommunityStatsSnapshot()).toMatchObject({ registeredUsers: 0, asOf: null });
    expect(await repo.getActivePublicPostsCount()).toBe(0);
  });

  it('reports a missing function as unavailable', async () => {
    const { client } = createFakeClient({
      rpc: { community_stats: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });
    await expect(new SupabaseStatsRepository(client).getCommunityStatsSnapshot()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('listMyActivityTimeline', () => {
  it('maps the rows and falls back to a creation for a kind the app has no label for', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        my_activity_timeline: ok([
          { occurred_at: 't1', kind: 'marked_as_recipient', post_id: 'p1', post_title: 'Sofa', actor_id: 'u2', actor_display_name: 'Dana' },
          { occurred_at: 't2', kind: 'something_new', post_id: 'p2', post_title: 'Bike', actor_id: 'u1', actor_display_name: 'Me' },
        ]),
      },
    });

    const items = await new SupabaseStatsRepository(client).listMyActivityTimeline(25);

    expect(callsTo(calls, 'my_activity_timeline')[0]?.args).toEqual({ p_limit: 25 });
    expect(items).toEqual([
      { occurredAt: 't1', kind: 'marked_as_recipient', postId: 'p1', postTitle: 'Sofa', actorDisplayName: 'Dana' },
      { occurredAt: 't2', kind: 'post_created', postId: 'p2', postTitle: 'Bike', actorDisplayName: 'Me' },
    ]);
  });
});

describe('capabilities the baseline lacks (M14, M15)', () => {
  it('throws BackendUnavailableError for the funnel and the per-world givings, without calling the server', async () => {
    const { client, calls } = createFakeClient();
    const repo = new SupabaseStatsRepository(client);

    await expect(repo.getWorldFlowFunnel(30)).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.listMyWorldGivings()).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(calls).toHaveLength(0);
  });
});
