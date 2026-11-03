import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import { executePostUpdate } from '../executePostUpdate';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Media-patch branches of executePostUpdate. Companion to
// executePostUpdate.test.ts (which covers the empty + field-only paths).

interface FakeOpts {
  postsUpdateError?: { message: string } | null;
  mediaDeleteError?: { message: string } | null;
  mediaInsertError?: { message: string } | null;
}
interface Calls {
  postsUpdates: { row: any }[];
  mediaDeletes: number;
  mediaInserts: { rows: any[] }[];
}

function makeFakeClient(opts: FakeOpts = {}): { client: SupabaseClient<any>; calls: Calls } {
  const calls: Calls = { postsUpdates: [], mediaDeletes: 0, mediaInserts: [] };
  const client = {
    from: (table: string) => {
      if (table === 'posts') {
        return {
          update: (row: any) => ({
            eq: async () => {
              calls.postsUpdates.push({ row });
              return { error: opts.postsUpdateError ?? null };
            },
          }),
        };
      }
      return {
        delete: () => ({
          eq: async () => {
            calls.mediaDeletes++;
            return { error: opts.mediaDeleteError ?? null };
          },
        }),
        insert: async (rows: any[]) => {
          calls.mediaInserts.push({ rows });
          return { error: opts.mediaInsertError ?? null };
        },
      };
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const FAKE_POST: Post = {
  postId: 'p_1',
  ownerId: 'u_1',
  type: 'Give',
  status: 'open',
  visibility: 'Public',
  title: 'A title',
  description: null,
  category: 'Other',
  address: { city: 'IL-001', cityName: 'Tel Aviv', street: '', streetNumber: '' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: 'Good',
  urgency: null,
  reopenCount: 0,
  listingId: null,
  listingWorldSlug: null,
  deleteAfter: null,
  createdAt: '2026-05-16T10:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
} as Post;

describe('executePostUpdate — media patch', () => {
  it('media-only patch fetches first (for current.title), runs a title no-op update, then delete+insert', async () => {
    const { client, calls } = makeFakeClient({});
    let fetchCount = 0;
    await executePostUpdate(
      client,
      'p_1',
      { mediaAssets: [{ path: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100 }] },
      async () => {
        fetchCount++;
        return FAKE_POST;
      },
    );
    expect(fetchCount).toBeGreaterThanOrEqual(2);
    expect(calls.postsUpdates[0]?.row).toEqual({ title: FAKE_POST.title });
    expect(calls.mediaDeletes).toBe(1);
    expect(calls.mediaInserts[0]?.rows).toEqual([
      { post_id: 'p_1', ordinal: 0, path: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 100 },
    ]);
  });

  it('empty media array deletes existing media but does NOT insert any new rows', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(client, 'p_1', { mediaAssets: [] }, async () => FAKE_POST);
    expect(calls.mediaDeletes).toBe(1);
    expect(calls.mediaInserts).toHaveLength(0);
  });

  it('field patch + media patch runs the field update once (not the title no-op) and then media replace', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(
      client,
      'p_1',
      { title: 'new', mediaAssets: [{ path: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }] },
      async () => FAKE_POST,
    );
    expect(calls.postsUpdates).toHaveLength(1);
    expect(calls.postsUpdates[0]?.row).toEqual({ title: 'new' });
    expect(calls.mediaDeletes).toBe(1);
    expect(calls.mediaInserts).toHaveLength(1);
  });

  it('throws "not found after update" when the final fetch returns null', async () => {
    const { client } = makeFakeClient({});
    let calls = 0;
    await expect(
      executePostUpdate(client, 'p_1', { title: 'x' }, async () => (++calls === 1 ? null : FAKE_POST)),
    ).rejects.toThrow('update: post p_1 not found after update');
  });

  it('throws "update.media_delete: " on media delete error', async () => {
    const { client } = makeFakeClient({ mediaDeleteError: { message: 'rls denied' } });
    await expect(
      executePostUpdate(client, 'p_1', { mediaAssets: [] }, async () => FAKE_POST),
    ).rejects.toThrow('update.media_delete: rls denied');
  });

  it('throws "update.media_insert: " on media insert error', async () => {
    const { client } = makeFakeClient({ mediaInsertError: { message: 'check failed' } });
    await expect(
      executePostUpdate(
        client,
        'p_1',
        { mediaAssets: [{ path: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }] },
        async () => FAKE_POST,
      ),
    ).rejects.toThrow('update.media_insert: check failed');
  });

  it('preserves media-asset ordering via the ordinal index', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(
      client,
      'p_1',
      {
        mediaAssets: [
          { path: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1 },
          { path: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 2 },
          { path: 'c.jpg', mimeType: 'image/jpeg', sizeBytes: 3 },
        ],
      },
      async () => FAKE_POST,
    );
    expect(calls.mediaInserts[0]?.rows.map((r: any) => ({ path: r.path, ordinal: r.ordinal }))).toEqual([
      { path: 'a.jpg', ordinal: 0 },
      { path: 'b.jpg', ordinal: 1 },
      { path: 'c.jpg', ordinal: 2 },
    ]);
  });
});
