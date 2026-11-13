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
          { occurred_at: 't1', kind: 'marked_as_recipient', post_id: 'p1', post_title: 'Sofa', actor_id: 'u2', actor_display_name: 'Dana', world_slug: 'time' },
          { occurred_at: 't2', kind: 'something_new', post_id: 'p2', post_title: 'Bike', actor_id: 'u1', actor_display_name: 'Me', world_slug: null },
        ]),
      },
    });

    const items = await new SupabaseStatsRepository(client).listMyActivityTimeline(25);

    expect(callsTo(calls, 'my_activity_timeline')[0]?.args).toEqual({ p_limit: 25 });
    expect(items).toEqual([
      { occurredAt: 't1', kind: 'marked_as_recipient', postId: 'p1', postTitle: 'Sofa', actorDisplayName: 'Dana', worldSlug: 'time' },
      { occurredAt: 't2', kind: 'post_created', postId: 'p2', postTitle: 'Bike', actorDisplayName: 'Me', worldSlug: null },
    ]);
  });
});

describe('getWorldFlowFunnel (FR-STATS-007)', () => {
  it('calls admin_world_flow_funnel with the window and maps the rows, keeping untracked stages null', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        admin_world_flow_funnel: ok([
          { world_slug: 'items', world_label_he: 'i', world_label_en: 'Items', direction: 'give', published: 4, booked: 3,
            confirmed: 2, completed: 1, cancelled: 1, closed: 2, median_hours_to_booking: 4, median_hours_to_completion: 10 },
          { world_slug: 'money', world_label_he: 'm', world_label_en: 'Money', direction: 'give', published: 1, booked: null,
            confirmed: null, completed: null, cancelled: null, closed: 0, median_hours_to_booking: null, median_hours_to_completion: null },
        ]),
      },
    });

    const rows = await new SupabaseStatsRepository(client).getWorldFlowFunnel(30);

    expect(calls[0]).toMatchObject({ fn: 'admin_world_flow_funnel', args: { p_days: 30 } });
    expect(rows[0]).toEqual({
      worldSlug: 'items', worldLabelHe: 'i', worldLabelEn: 'Items', direction: 'give', published: 4, booked: 3,
      confirmed: 2, completed: 1, cancelled: 1, closed: 2, medianHoursToBooking: 4, medianHoursToCompletion: 10,
    });
    expect(rows[1]).toMatchObject({ booked: null, completed: null, medianHoursToBooking: null, closed: 0 });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { admin_world_flow_funnel: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });
    await expect(new SupabaseStatsRepository(client).getWorldFlowFunnel(30)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('listMyWorldGivings (FR-STATS-008)', () => {
  it('calls my_world_givings without a member id and maps the rows', async () => {
    const { client, calls } = createFakeClient({
      rpc: { my_world_givings: ok([{ world_slug: 'items', world_label_he: 'i', world_label_en: 'Items', given: 2, received: 0, closed: 3 }]) },
    });

    const rows = await new SupabaseStatsRepository(client).listMyWorldGivings();

    expect(calls[0]).toMatchObject({ fn: 'my_world_givings', args: undefined });
    expect(rows).toEqual([{ worldSlug: 'items', worldLabelHe: 'i', worldLabelEn: 'Items', given: 2, received: 0, closed: 3 }]);
  });
});
