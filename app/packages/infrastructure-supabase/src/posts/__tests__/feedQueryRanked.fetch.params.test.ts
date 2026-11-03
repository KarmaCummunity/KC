import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostFeedFilter } from '@kc/application';
import { encodeRankedCursor, fetchRankedFeedPage } from '../feedQueryRanked';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  rpc?: { data?: unknown; error?: { message: string } | null };
  posts?: { data?: unknown; error?: { message: string } | null };
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: SupabaseClient<any>;
  ops: Array<{ kind: string; args?: unknown[] }>;
  rpcCalls: Array<{ name: string; params: any }>;
} {
  const ops: Array<{ kind: string; args?: unknown[] }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  function makeChain(result: () => { data: unknown; error: { message: string } | null }): any {
    return new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) =>
            Promise.resolve(result()).then(onFulfilled, onRejected);
        }
        return (...args: any[]) => {
          ops.push({ kind: prop, args });
          return makeChain(result);
        };
      },
    });
  }
  const client = {
    rpc: (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({
        data: opts.rpc?.data ?? null,
        error: opts.rpc?.error ?? null,
      });
    },
    from: (table: string) => {
      ops.push({ kind: 'from', args: [table] });
      return makeChain(() => ({
        data: opts.posts?.data ?? null,
        error: opts.posts?.error ?? null,
      }));
    },
  } as unknown as SupabaseClient<any>;
  return { client, ops, rpcCalls };
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('fetchRankedFeedPage — RPC params + early-exit branches', () => {
  it('passes through filter + viewer + pageLimit+1 to feed_ranked_ids RPC', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpc: { data: [] } });
    const filter: PostFeedFilter = {
      type: 'Give',
      categories: ['Electronics'],
      itemConditions: ['Good'],
      statusFilter: 'open',
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: 10 },
      sortOrder: 'distance',
      proximitySortCity: 'IL-001',
      followersOnly: true,
    };
    await fetchRankedFeedPage(client, 'viewer-1', filter, undefined, 10);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe('feed_ranked_ids');
    expect(rpcCalls[0]?.params).toEqual({
      p_viewer_id: 'viewer-1',
      p_filter_type: 'Give',
      p_filter_categories: ['Electronics'],
      p_filter_item_conditions: ['Good'],
      p_filter_status: 'open',
      p_filter_center_city: 'IL-001',
      p_filter_radius_km: 10,
      p_sort_order: 'distance',
      p_proximity_sort_city: 'IL-001',
      p_page_limit: 11,
      p_followers_only: true,
      p_cursor_rank_score: undefined,
    });
  });

  it('uses the zero UUID when viewerId is null (anon viewer)', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpc: { data: [] } });
    await fetchRankedFeedPage(client, null, {}, undefined, 10);
    expect(rpcCalls[0]?.params.p_viewer_id).toBe(ZERO_UUID);
  });

  it('defaults statusFilter to "open", sortOrder to "newest", followersOnly to false, omits empty array filters', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpc: { data: [] } });
    await fetchRankedFeedPage(client, 'v', { categories: [], itemConditions: [] }, undefined, 5);
    expect(rpcCalls[0]?.params.p_filter_status).toBe('open');
    expect(rpcCalls[0]?.params.p_sort_order).toBe('newest');
    expect(rpcCalls[0]?.params.p_followers_only).toBe(false);
    expect(rpcCalls[0]?.params.p_filter_categories).toBeUndefined();
    expect(rpcCalls[0]?.params.p_filter_item_conditions).toBeUndefined();
    expect(rpcCalls[0]?.params.p_page_limit).toBe(6);
  });

  it('forwards worlds and subcategories to the feed_ranked_ids RPC', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpc: { data: [] } });
    const filter: PostFeedFilter = {
      worlds: ['items', 'food'],
      subcategories: ['books', 'bakery'],
    };
    await fetchRankedFeedPage(client, 'viewer-1', filter, undefined, 10);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.params.p_filter_worlds).toEqual(['items', 'food']);
    expect(rpcCalls[0]?.params.p_filter_subcategories).toEqual(['books', 'bakery']);
  });

  it('decodes the cursor and forwards the three cursor params to the RPC', async () => {
    const { client, rpcCalls } = makeFakeClient({ rpc: { data: [] } });
    const cursor = encodeRankedCursor({
      distanceKm: 12.5,
      createdAt: '2026-05-16T12:00:00.000Z',
      postId: 'p_prev',
    });
    await fetchRankedFeedPage(client, 'v', {}, cursor, 10);
    expect(rpcCalls[0]?.params.p_cursor_distance).toBe(12.5);
    expect(rpcCalls[0]?.params.p_cursor_created_at).toBe('2026-05-16T12:00:00.000Z');
    expect(rpcCalls[0]?.params.p_cursor_post_id).toBe('p_prev');
  });

  it('throws "feed_ranked_ids: <msg>" when the RPC errors (and never queries posts)', async () => {
    const { client, ops } = makeFakeClient({ rpc: { error: { message: 'rls denied' } } });
    await expect(fetchRankedFeedPage(client, 'v', {}, undefined, 10))
      .rejects.toThrow('feed_ranked_ids: rls denied');
    expect(ops.find((o) => o.kind === 'from')).toBeUndefined();
  });

  it('returns { posts: [], nextCursor: null } when ranked is empty and skips the posts query', async () => {
    const { client, ops } = makeFakeClient({ rpc: { data: [] } });
    const out = await fetchRankedFeedPage(client, 'v', {}, undefined, 10);
    expect(out).toEqual({ posts: [], nextCursor: null });
    expect(ops.find((o) => o.kind === 'from')).toBeUndefined();
  });

  it('returns { posts: [], nextCursor: null } when ranked is null (defensive against PostgREST nulls)', async () => {
    const { client } = makeFakeClient({ rpc: { data: null } });
    const out = await fetchRankedFeedPage(client, 'v', {}, undefined, 10);
    expect(out).toEqual({ posts: [], nextCursor: null });
  });
});
