import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseStatsRepository } from '../SupabaseStatsRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  snapshotData?: any;
  snapshotError?: { message: string } | null;
  rpcData?: unknown;
  rpcError?: { code?: string; message: string } | null;
}
interface RpcCall { fn: string; args: unknown }

function makeFakeClient(opts: FakeOpts): { client: SupabaseClient<any>; rpcs: RpcCall[] } {
  const rpcs: RpcCall[] = [];
  const client = {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({
          data: opts.snapshotData ?? null,
          error: opts.snapshotError ?? null,
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
    },
  } as unknown as SupabaseClient<any>;
  return { client, rpcs };
}

describe('SupabaseStatsRepository — getCommunityStatsSnapshot', () => {
  it('reads from community_stats and maps the row to camelCase + Number()-coerced fields', async () => {
    const { client } = makeFakeClient({
      snapshotData: {
        registered_users: 100,
        active_public_posts: 25,
        items_delivered_total: 80,
        as_of: '2026-05-16T12:00:00.000Z',
      },
    });
    expect(await new SupabaseStatsRepository(client).getCommunityStatsSnapshot()).toEqual({
      registeredUsers: 100,
      activePublicPosts: 25,
      itemsDeliveredTotal: 80,
      asOf: '2026-05-16T12:00:00.000Z',
    });
  });

  it('coerces null/undefined counters to 0 and missing as_of to null (defensive defaults)', async () => {
    const { client } = makeFakeClient({ snapshotData: null });
    expect(await new SupabaseStatsRepository(client).getCommunityStatsSnapshot()).toEqual({
      registeredUsers: 0,
      activePublicPosts: 0,
      itemsDeliveredTotal: 0,
      asOf: null,
    });
  });

  it('coerces non-numeric values via Number() (defensive — view sometimes returns strings)', async () => {
    const { client } = makeFakeClient({
      snapshotData: { registered_users: '99', active_public_posts: '7', items_delivered_total: '3', as_of: null },
    });
    const s = await new SupabaseStatsRepository(client).getCommunityStatsSnapshot();
    expect(s.registeredUsers).toBe(99);
    expect(s.activePublicPosts).toBe(7);
    expect(s.itemsDeliveredTotal).toBe(3);
  });

  it('throws with a prefixed "getCommunityStatsSnapshot: " message on query error', async () => {
    const { client } = makeFakeClient({ snapshotError: { message: 'rls denied' } });
    await expect(new SupabaseStatsRepository(client).getCommunityStatsSnapshot()).rejects.toThrow(
      'getCommunityStatsSnapshot: rls denied',
    );
  });
});

describe('SupabaseStatsRepository — getActivePublicPostsCount', () => {
  it('returns the activePublicPosts field from the snapshot (delegates, no extra query)', async () => {
    const { client } = makeFakeClient({
      snapshotData: { registered_users: 0, active_public_posts: 42, items_delivered_total: 0, as_of: null },
    });
    expect(await new SupabaseStatsRepository(client).getActivePublicPostsCount()).toBe(42);
  });
});

describe('SupabaseStatsRepository — listMyActivityTimeline', () => {
  it('calls rpc_my_activity_timeline with { p_limit } and maps rows to camelCase', async () => {
    const { client, rpcs } = makeFakeClient({
      rpcData: [
        {
          occurred_at: '2026-05-16T12:00:00.000Z',
          kind: 'post_created',
          post_id: 'p_1',
          post_title: 'Title',
          actor_display_name: 'Alice',
          world_slug: 'time',
        },
      ],
    });
    const out = await new SupabaseStatsRepository(client).listMyActivityTimeline(50);
    expect(rpcs).toEqual([{ fn: 'rpc_my_activity_timeline', args: { p_limit: 50 } }]);
    expect(out).toEqual([
      {
        occurredAt: '2026-05-16T12:00:00.000Z',
        kind: 'post_created',
        postId: 'p_1',
        postTitle: 'Title',
        actorDisplayName: 'Alice',
        worldSlug: 'time',
      },
    ]);
  });

  it('coerces an unknown kind to "post_created" (defensive fallback for future enum values)', async () => {
    const { client } = makeFakeClient({
      rpcData: [
        { occurred_at: 't', kind: 'totally_new_kind', post_id: 'p', post_title: 't', actor_display_name: null },
      ],
    });
    const out = await new SupabaseStatsRepository(client).listMyActivityTimeline(10);
    expect(out[0]?.kind).toBe('post_created');
  });

  it('reads a row without a world (a server before 0742) as no world', async () => {
    const { client } = makeFakeClient({
      rpcData: [
        { occurred_at: 't', kind: 'post_created', post_id: 'p', post_title: 't', actor_display_name: null },
      ],
    });
    const out = await new SupabaseStatsRepository(client).listMyActivityTimeline(10);
    expect(out[0]?.worldSlug).toBeNull();
  });

  it('returns [] when the RPC returns null data', async () => {
    const { client } = makeFakeClient({ rpcData: null });
    expect(await new SupabaseStatsRepository(client).listMyActivityTimeline(10)).toEqual([]);
  });

  describe('RPC-missing detection (silently returns [])', () => {
    const cases: Array<[string, { code?: string; message: string }]> = [
      ['PGRST202 → []', { code: 'PGRST202', message: 'something' }],
      ['42883 → []', { code: '42883', message: 'function not found' }],
      ['plain "not found" message → []', { message: 'not found' }],
      ['"could not find" + function name → []', { message: 'could not find rpc_my_activity_timeline' }],
      ['"does not exist" + function name → []', { message: 'rpc_my_activity_timeline does not exist' }],
    ];
    for (const [label, error] of cases) {
      it(label, async () => {
        const { client } = makeFakeClient({ rpcError: error });
        expect(await new SupabaseStatsRepository(client).listMyActivityTimeline(10)).toEqual([]);
      });
    }
  });

  it('throws on any other RPC error with prefixed "listMyActivityTimeline: " message', async () => {
    const { client } = makeFakeClient({
      rpcError: { code: '42501', message: 'permission denied' },
    });
    await expect(
      new SupabaseStatsRepository(client).listMyActivityTimeline(10),
    ).rejects.toThrow('listMyActivityTimeline: permission denied');
  });
});
