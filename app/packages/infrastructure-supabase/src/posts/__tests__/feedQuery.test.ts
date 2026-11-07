import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFeedQuery } from '../feedQuery';
import { encodeCursor } from '../cursor';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Op =
  | { kind: 'from'; table: string }
  | { kind: 'select'; cols: string }
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'gt'; col: string; val: unknown }
  | { kind: 'lt'; col: string; val: unknown }
  | { kind: 'order'; col: string; ascending: boolean }
  | { kind: 'or'; expr: string }
  | { kind: 'limit'; n: number };

interface FakeClientResult {
  client: SupabaseClient<any>;
  ops: Op[];
}

function makeFakeClient(): FakeClientResult {
  const ops: Op[] = [];
  // Chainable proxy — every method records its op and returns the same
  // proxy so the builder pattern keeps composing.
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: any[]) => {
          switch (prop) {
            case 'select':
              ops.push({ kind: 'select', cols: args[0] });
              break;
            case 'eq':
              ops.push({ kind: 'eq', col: args[0], val: args[1] });
              break;
            case 'in':
              ops.push({ kind: 'in', col: args[0], vals: args[1] });
              break;
            case 'gt':
              ops.push({ kind: 'gt', col: args[0], val: args[1] });
              break;
            case 'lt':
              ops.push({ kind: 'lt', col: args[0], val: args[1] });
              break;
            case 'order':
              ops.push({ kind: 'order', col: args[0], ascending: args[1]?.ascending });
              break;
            case 'limit':
              ops.push({ kind: 'limit', n: args[0] });
              break;
            case 'or':
              ops.push({ kind: 'or', expr: args[0] });
              break;
            default:
              throw new Error(`fake: unexpected chain method ${prop}`);
          }
          return chain;
        };
      },
    },
  );
  const client = {
    from: (table: string) => {
      ops.push({ kind: 'from', table });
      return chain;
    },
  } as unknown as SupabaseClient<any>;
  return { client, ops };
}

function findOp<T extends Op['kind']>(ops: Op[], kind: T): Extract<Op, { kind: T }> | undefined {
  return ops.find((o) => o.kind === kind) as Extract<Op, { kind: T }> | undefined;
}

describe('buildFeedQuery — base shape', () => {
  it('targets the posts table and selects POST_SELECT_OWNER', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 10);
    expect(findOp(ops, 'from')?.table).toBe('posts');
    expect(findOp(ops, 'select')?.cols).toContain('owner:users');
  });

  it('never lists a post hidden from the feed (posts.feed_hidden, 0557)', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 10);
    expect(ops.find((o) => o.kind === 'eq' && o.col === 'feed_hidden')).toEqual({ kind: 'eq', col: 'feed_hidden', val: false });
  });

  it('limits to pageLimit + 1 (next-page sentinel)', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 20);
    expect(findOp(ops, 'limit')?.n).toBe(21);
  });
});

describe('buildFeedQuery — status filter branches', () => {
  it("defaults to status === 'open' when statusFilter is omitted", () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 10);
    const eq = ops.find((o) => o.kind === 'eq' && o.col === 'status') as Extract<Op, { kind: 'eq' }>;
    expect(eq?.val).toBe('open');
    expect(ops.find((o) => o.kind === 'in' && o.col === 'status')).toBeUndefined();
  });

  it("emits status IN ('open', 'closed_delivered') for statusFilter='all'", () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { statusFilter: 'all' }, undefined, 10);
    const inOp = ops.find((o) => o.kind === 'in' && o.col === 'status') as Extract<Op, { kind: 'in' }>;
    expect(inOp?.vals).toEqual(['open', 'closed_delivered']);
  });

  it("emits status === 'closed_delivered' for statusFilter='closed'", () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { statusFilter: 'closed' }, undefined, 10);
    const eq = ops.find((o) => o.kind === 'eq' && o.col === 'status') as Extract<Op, { kind: 'eq' }>;
    expect(eq?.val).toBe('closed_delivered');
  });
});

describe('buildFeedQuery — optional filters', () => {
  it('emits eq(type, ...) when type is set', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { type: 'Give' }, undefined, 10);
    expect(ops.find((o) => o.kind === 'eq' && o.col === 'type')).toEqual({ kind: 'eq', col: 'type', val: 'Give' });
  });

  it('emits in(category, ...) when categories is non-empty', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { categories: ['Electronics', 'Furniture'] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'in' && o.col === 'category')).toEqual({ kind: 'in', col: 'category', vals: ['Electronics', 'Furniture'] });
  });

  it('skips category filter for an empty categories array', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { categories: [] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'in' && o.col === 'category')).toBeUndefined();
  });

  it('emits in(item_condition, ...) when itemConditions is non-empty', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { itemConditions: ['Good', 'LikeNew'] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'in' && o.col === 'item_condition')).toEqual({ kind: 'in', col: 'item_condition', vals: ['Good', 'LikeNew'] });
  });

  it('emits in(listing_world_slug, ...) when worlds is non-empty and does not include items', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { worlds: ['food', 'rides'] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'in' && o.col === 'listing_world_slug')).toEqual({
      kind: 'in',
      col: 'listing_world_slug',
      vals: ['food', 'rides'],
    });
  });

  it('emits or(listing_world_slug.in..., listing_world_slug.is.null) when worlds includes items', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { worlds: ['items', 'food'] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'or' && o.expr.includes('listing_world_slug.is.null'))).toEqual({
      kind: 'or',
      expr: 'listing_world_slug.in.(items,food),listing_world_slug.is.null',
    });
  });

  it('skips worlds filter for an empty worlds array', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { worlds: [] }, undefined, 10);
    expect(ops.find((o) => o.kind === 'in' && o.col === 'listing_world_slug')).toBeUndefined();
    expect(ops.find((o) => o.kind === 'or' && o.expr.includes('listing_world_slug'))).toBeUndefined();
  });
});

describe('buildFeedQuery — sort order + cursor', () => {
  it('orders by created_at descending by default (newest-first)', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 10);
    const order = ops.find((o) => o.kind === 'order' && o.col === 'created_at') as Extract<Op, { kind: 'order' }>;
    expect(order?.ascending).toBe(false);
  });

  it("orders ascending when sortOrder === 'oldest'", () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { sortOrder: 'oldest' }, undefined, 10);
    const order = ops.find((o) => o.kind === 'order' && o.col === 'created_at') as Extract<Op, { kind: 'order' }>;
    expect(order?.ascending).toBe(true);
  });

  it('emits lt(created_at, cursor.createdAt) for newest-first paging', () => {
    const { client, ops } = makeFakeClient();
    const cursor = encodeCursor({ createdAt: '2026-05-16T12:00:00.000Z' });
    buildFeedQuery(client, {}, cursor, 10);
    const lt = ops.find((o) => o.kind === 'lt' && o.col === 'created_at') as Extract<Op, { kind: 'lt' }>;
    expect(lt?.val).toBe('2026-05-16T12:00:00.000Z');
    expect(ops.find((o) => o.kind === 'gt' && o.col === 'created_at')).toBeUndefined();
  });

  it("emits gt(created_at, cursor.createdAt) for sortOrder='oldest' paging", () => {
    const { client, ops } = makeFakeClient();
    const cursor = encodeCursor({ createdAt: '2026-05-16T12:00:00.000Z' });
    buildFeedQuery(client, { sortOrder: 'oldest' }, cursor, 10);
    const gt = ops.find((o) => o.kind === 'gt' && o.col === 'created_at') as Extract<Op, { kind: 'gt' }>;
    expect(gt?.val).toBe('2026-05-16T12:00:00.000Z');
    expect(ops.find((o) => o.kind === 'lt' && o.col === 'created_at')).toBeUndefined();
  });

  it('omits the cursor comparison when cursor is undefined', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, undefined, 10);
    expect(ops.find((o) => o.kind === 'gt' && o.col === 'created_at')).toBeUndefined();
    expect(ops.find((o) => o.kind === 'lt' && o.col === 'created_at')).toBeUndefined();
  });
});

describe('buildFeedQuery — (created_at, post_id) keyset', () => {
  const postId = '11111111-2222-4333-8444-555555555555';
  const ts = '2026-05-16T12:00:00.000Z';

  it('pages newest-first on (created_at, post_id) when the cursor carries postId', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, {}, encodeCursor({ createdAt: ts, postId }), 10);
    const or = findOp(ops, 'or');
    expect(or?.expr).toBe(`created_at.lt."${ts}",and(created_at.eq."${ts}",post_id.lt.${postId})`);
    expect(ops.find((o) => o.kind === 'lt')).toBeUndefined();
    const orders = ops.filter((o) => o.kind === 'order') as Array<Extract<Op, { kind: 'order' }>>;
    expect(orders.map((o) => [o.col, o.ascending])).toEqual([
      ['created_at', false],
      ['post_id', false],
    ]);
  });

  it('uses gt for oldest-first keyset paging', () => {
    const { client, ops } = makeFakeClient();
    buildFeedQuery(client, { sortOrder: 'oldest' }, encodeCursor({ createdAt: ts, postId }), 10);
    expect(findOp(ops, 'or')?.expr).toContain(`post_id.gt.${postId}`);
  });

  it('ignores a malformed postId and falls back to created_at only', () => {
    const { client, ops } = makeFakeClient();
    const raw = encodeURIComponent(JSON.stringify({ createdAt: ts, postId: 'x),or(true' }));
    buildFeedQuery(client, {}, raw, 10);
    expect(findOp(ops, 'or')).toBeUndefined();
    expect(findOp(ops, 'lt')?.val).toBe(ts);
  });
});
