import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostStatus } from '@kc/domain';
import { SupabasePostRepository } from '../SupabasePostRepository';
import { encodeCursor } from '../cursor';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  data?: unknown;
  error?: { message: string } | null;
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: SupabaseClient<any>;
  ops: Array<{ kind: string; args?: unknown[] }>;
} {
  const ops: Array<{ kind: string; args?: unknown[] }> = [];
  const result = () => ({ data: opts.data ?? null, error: opts.error ?? null });
  function makeChain(): any {
    return new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) =>
            Promise.resolve(result()).then(onFulfilled, onRejected);
        }
        return (...args: any[]) => {
          ops.push({ kind: prop, args });
          return makeChain();
        };
      },
    });
  }
  const client = {
    from: (table: string) => {
      ops.push({ kind: 'from', args: [table] });
      return makeChain();
    },
  } as unknown as SupabaseClient<any>;
  return { client, ops };
}

function postRow(post_id: string, created_at: string): any {
  return {
    post_id, owner_id: 'u_me', type: 'Give', status: 'open', visibility: 'Public',
    title: `t ${post_id}`, description: null, category: 'Other', city: 'IL-001',
    street: null, street_number: null, location_display_level: 'CityOnly',
    item_condition: 'Good', urgency: null, reopen_count: 0, delete_after: null,
    created_at, updated_at: created_at,
  };
}

describe('SupabasePostRepository.getMyPosts', () => {
  it('returns { posts: [], nextCursor: null } and skips the query when status is empty', async () => {
    const { client, ops } = makeFakeClient();
    const repo = new SupabasePostRepository(client);
    const out = await repo.getMyPosts('u_me', [], 10);
    expect(out).toEqual({ posts: [], nextCursor: null });
    expect(ops.find((o) => o.kind === 'from')).toBeUndefined();
  });

  it('queries posts with owner_id eq + status IN + order created_at desc + limit (safeLimit + 1)', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open', 'delivered'] as PostStatus[], 10);

    expect(ops.find((o) => o.kind === 'from')?.args).toEqual(['posts']);
    const eq = ops.find((o) => o.kind === 'eq');
    expect(eq?.args).toEqual(['owner_id', 'u_me']);
    // Feed mirrors of listings are not "my posts" (D-206).
    expect(ops.find((o) => o.kind === 'is')?.args).toEqual(['listing_id', null]);
    const inOp = ops.find((o) => o.kind === 'in');
    expect(inOp?.args).toEqual(['status', ['open', 'delivered']]);
    expect(ops.find((o) => o.kind === 'order')?.args).toEqual(['created_at', { ascending: false }]);
    // safeLimit + 1 → 11 (over-fetches by 1 so we can detect hasMore without
    // a second round-trip).
    expect(ops.find((o) => o.kind === 'limit')?.args).toEqual([11]);
  });

  it('clamps safeLimit to FEED_HARD_MAX=100 (over-fetch then caps to 101)', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 999);
    expect(ops.find((o) => o.kind === 'limit')?.args).toEqual([101]);
  });

  it('clamps safeLimit to a minimum of 1 (zero or negative becomes 1 + 1 = 2)', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 0);
    expect(ops.find((o) => o.kind === 'limit')?.args).toEqual([2]);
  });

  it('applies lt(created_at, cursor.createdAt) when a valid cursor is supplied', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    const cursor = encodeCursor({ createdAt: '2026-05-16T12:00:00.000Z' });
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 10, cursor);
    const lt = ops.find((o) => o.kind === 'lt');
    expect(lt?.args).toEqual(['created_at', '2026-05-16T12:00:00.000Z']);
  });

  it('applies visibility neq when excludeVisibility is set', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 10, undefined, undefined, 'OnlyMe');
    expect(ops.find((o) => o.kind === 'neq')?.args).toEqual(['visibility', 'OnlyMe']);
  });

  it('applies visibility eq when visibility filter is set', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 10, undefined, 'OnlyMe');
    expect(ops.filter((o) => o.kind === 'eq').map((o) => o.args)).toContainEqual(['visibility', 'OnlyMe']);
  });

  it('skips the lt() clause when the cursor is malformed (defensive)', async () => {
    const { client, ops } = makeFakeClient({ data: [] });
    const repo = new SupabasePostRepository(client);
    await repo.getMyPosts('u_me', ['open'] as PostStatus[], 10, 'not-json');
    expect(ops.find((o) => o.kind === 'lt')).toBeUndefined();
  });

  it('throws "getMyPosts: <msg>" on query error', async () => {
    const { client } = makeFakeClient({ error: { message: 'rls denied' } });
    const repo = new SupabasePostRepository(client);
    await expect(
      repo.getMyPosts('u_me', ['open'] as PostStatus[], 10),
    ).rejects.toThrow('getMyPosts: rls denied');
  });

  it('emits a nextCursor with the last visible row when the result over-fetches (hasMore)', async () => {
    // Asked for 2, returned 3 → hasMore=true, page=[a,b], nextCursor encodes b.
    const data = [
      postRow('p_a', '2026-05-16T13:00:00.000Z'),
      postRow('p_b', '2026-05-16T12:00:00.000Z'),
      postRow('p_c', '2026-05-16T11:00:00.000Z'),
    ];
    const { client } = makeFakeClient({ data });
    const repo = new SupabasePostRepository(client);
    const out = await repo.getMyPosts('u_me', ['open'] as PostStatus[], 2);
    expect(out.posts.map((p) => p.postId)).toEqual(['p_a', 'p_b']);
    expect(out.nextCursor).not.toBeNull();
    const decoded = JSON.parse(decodeURIComponent(out.nextCursor!));
    expect(decoded).toEqual({ createdAt: '2026-05-16T12:00:00.000Z' });
  });

  it('returns nextCursor=null when rows.length <= safeLimit (no overflow)', async () => {
    const data = [
      postRow('p_a', '2026-05-16T13:00:00.000Z'),
      postRow('p_b', '2026-05-16T12:00:00.000Z'),
    ];
    const { client } = makeFakeClient({ data });
    const repo = new SupabasePostRepository(client);
    const out = await repo.getMyPosts('u_me', ['open'] as PostStatus[], 2);
    expect(out.posts.map((p) => p.postId)).toEqual(['p_a', 'p_b']);
    expect(out.nextCursor).toBeNull();
  });

  it('returns mapped Post entities (not raw rows) and empty array when data is null', async () => {
    const { client } = makeFakeClient({ data: null });
    const repo = new SupabasePostRepository(client);
    const out = await repo.getMyPosts('u_me', ['open'] as PostStatus[], 10);
    expect(out).toEqual({ posts: [], nextCursor: null });
  });
});
