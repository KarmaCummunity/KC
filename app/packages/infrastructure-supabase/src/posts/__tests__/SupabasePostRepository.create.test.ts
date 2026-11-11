import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreatePostInput } from '@kc/application';
import { SupabasePostRepository } from '../SupabasePostRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Step {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}
interface Op {
  kind: string;
  table?: string;
  args?: unknown[];
}

// Sequential step model: each terminal await consumes the NEXT step from the
// queue. Lets us script multi-call flows (create RPC → fetchPostById select →
// actor-identity RPC).
function makeFakeClient(steps: Step[]): { client: SupabaseClient<any>; ops: Op[] } {
  const ops: Op[] = [];
  let stepIdx = 0;
  let currentTable: string | undefined;
  const consume = () => {
    const s = steps[stepIdx++] ?? {};
    return { data: s.data ?? null, error: s.error ?? null };
  };
  function makeChain(table: string): any {
    return new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) =>
            Promise.resolve(consume()).then(onFulfilled, onRejected);
        }
        return (...args: any[]) => {
          ops.push({ kind: prop, table, args });
          return makeChain(table);
        };
      },
    });
  }
  const client = {
    from: (table: string) => {
      currentTable = table;
      ops.push({ kind: 'from', table, args: [table] });
      return makeChain(table);
    },
    rpc: (name: string, params: unknown) => {
      ops.push({ kind: 'rpc', args: [name, params] });
      return Promise.resolve(consume());
    },
  } as unknown as SupabaseClient<any>;
  // Silence unused-warning on currentTable (used implicitly through ops).
  void currentTable;
  return { client, ops };
}

const VALID_INPUT: CreatePostInput = {
  ownerId: 'u_me',
  type: 'Give',
  visibility: 'Public',
  title: 'Free Sofa',
  description: 'Good condition',
  category: 'Other',
  address: { city: 'IL-001', cityName: 'Tel Aviv', street: 'Main', streetNumber: '12' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: 'Good',
  urgency: null,
  mediaAssets: [],
};

const FETCH_ROW = {
  post_id: 'p_new', owner_id: 'u_me', type: 'Give', status: 'open', visibility: 'Public',
  title: 'Free Sofa', description: 'Good condition', category: 'Other', city: 'IL-001',
  street: 'Main', street_number: '12', location_display_level: 'CityOnly',
  item_condition: 'Good', urgency: null, reopen_count: 0, delete_after: null,
  created_at: '2026-05-16T12:00:00.000Z', updated_at: '2026-05-16T12:00:00.000Z',
};

describe('SupabasePostRepository.create — happy paths', () => {
  it('creates the post through create_post_with_media, then re-fetches the row via fetchPostById', async () => {
    const { client, ops } = makeFakeClient([
      { data: 'p_new' },   // create_post_with_media
      { data: FETCH_ROW }, // fetchPostById
    ]);
    const repo = new SupabasePostRepository(client);
    const out = await repo.create({ ...VALID_INPUT, mediaAssets: [] });
    expect(out.postId).toBe('p_new');

    // KC#2020: one RPC for the post and its photos; no direct table insert any more.
    expect(ops.filter((o) => o.kind === 'insert')).toEqual([]);
    expect(ops.filter((o) => o.kind === 'rpc').map((o) => o.args?.[0])).toEqual(['create_post_with_media']);
  });

  it('sends the photos in order with field mapping (path, mime_type, size_bytes) in the same call', async () => {
    const { client, ops } = makeFakeClient([{ data: 'p_new' }, { data: FETCH_ROW }]);
    const repo = new SupabasePostRepository(client);
    await repo.create({
      ...VALID_INPUT,
      mediaAssets: [
        { path: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
        { path: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 200 },
      ],
    });

    const params = ops.find((o) => o.kind === 'rpc')?.args?.[1] as { p_media: unknown };
    expect(params.p_media).toEqual([
      { path: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 100 },
      { path: 'b.jpg', mime_type: 'image/jpeg', size_bytes: 200 },
    ]);
  });

  it('calls upsert_post_actor_identity RPC when hideFromCounterparty is true (FR-POST-021)', async () => {
    const { client, ops } = makeFakeClient([
      { data: 'p_new' },
      { data: FETCH_ROW },
      { error: null },
    ]);
    const repo = new SupabasePostRepository(client);
    await repo.create({ ...VALID_INPUT, mediaAssets: [], hideFromCounterparty: true });

    const rpcOp = ops.find((o) => o.kind === 'rpc' && o.args?.[0] === 'upsert_post_actor_identity');
    expect(rpcOp?.args).toEqual([
      'upsert_post_actor_identity',
      {
        p_post_id: 'p_new',
        p_surface_visibility: 'Public',
        p_hide_from_counterparty: true,
      },
    ]);
  });

  it('sends the post with the address fields flattened and no owner (the server uses the caller)', async () => {
    const { client, ops } = makeFakeClient([{ data: 'p_new' }, { data: FETCH_ROW }]);
    const repo = new SupabasePostRepository(client);
    await repo.create(VALID_INPUT);
    const params = ops.find((o) => o.kind === 'rpc')?.args?.[1] as { p_post: Record<string, unknown> };
    expect(params.p_post.city).toBe('IL-001');
    expect(params.p_post.street).toBe('Main');
    expect(params.p_post.street_number).toBe('12');
    expect(params.p_post.type).toBe('Give');
    expect(params.p_post).not.toHaveProperty('owner_id');
  });
});

describe('SupabasePostRepository.create — error paths', () => {
  it('routes RPC errors through mapInsertError (PostError surface, not raw Error)', async () => {
    // 23502 = NOT NULL violation on title → mapInsertError → PostError('title_required').
    const { client } = makeFakeClient([
      { error: { message: 'null value in column "title"', code: '23502' } },
    ]);
    const repo = new SupabasePostRepository(client);
    await expect(repo.create(VALID_INPUT)).rejects.toMatchObject({ name: 'PostError', code: 'title_required' });
  });

  it('maps the D132 commit check (offer_photo_required) to image_required_for_give', async () => {
    const { client } = makeFakeClient([{ error: { message: 'offer_photo_required', code: '23514' } }]);
    const repo = new SupabasePostRepository(client);
    await expect(repo.create(VALID_INPUT)).rejects.toMatchObject({
      name: 'PostError',
      code: 'image_required_for_give',
    });
  });

  it('throws "create.post: no row returned" when the RPC succeeds with null data (defensive)', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    const repo = new SupabasePostRepository(client);
    await expect(repo.create(VALID_INPUT)).rejects.toThrow('create.post: no row returned');
  });

  it('throws "create: post <id> disappeared after insert" when fetchPostById returns null after success', async () => {
    const { client } = makeFakeClient([
      { data: 'p_new' },
      { data: null }, // fetchPostById finds nothing — race against external delete/RLS flip
    ]);
    const repo = new SupabasePostRepository(client);
    await expect(repo.create(VALID_INPUT)).rejects.toThrow('create: post p_new disappeared after insert');
  });
});
