import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import { executePostUpdate } from '../executePostUpdate';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  postsUpdateError?: { message: string } | null;
  mediaDeleteError?: { message: string } | null;
  mediaInsertError?: { message: string } | null;
}
interface PostsUpdateCall {
  row: any;
}
interface MediaInsertCall {
  rows: any[];
}
interface Calls {
  postsUpdates: PostsUpdateCall[];
  mediaDeletes: number;
  mediaInserts: MediaInsertCall[];
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
      // media_assets
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

describe('executePostUpdate — empty patch', () => {
  it('skips the DB entirely and returns the current post when patch has no fields and no media', async () => {
    const { client, calls } = makeFakeClient({});
    const fetch = async () => FAKE_POST;
    const out = await executePostUpdate(client, 'p_1', {}, fetch);
    expect(out).toBe(FAKE_POST);
    expect(calls.postsUpdates).toHaveLength(0);
    expect(calls.mediaDeletes).toBe(0);
  });

  it('throws "not found" when the empty-patch fetch returns null', async () => {
    const { client } = makeFakeClient({});
    await expect(
      executePostUpdate(client, 'p_missing', {}, async () => null),
    ).rejects.toThrow('update: post p_missing not found');
  });
});

describe('executePostUpdate — field-only patch', () => {
  it('updates posts row with snake_case columns for all 7 individual fields', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(
      client,
      'p_1',
      {
        title: 'new title',
        description: 'new desc',
        category: 'Electronics',
        locationDisplayLevel: 'CityAndStreet',
        itemCondition: 'LikeNew',
        urgency: 'urgent',
        visibility: 'FollowersOnly',
      },
      async () => FAKE_POST,
    );
    expect(calls.postsUpdates[0]?.row).toEqual({
      title: 'new title',
      description: 'new desc',
      category: 'Electronics',
      location_display_level: 'CityAndStreet',
      item_condition: 'LikeNew',
      urgency: 'urgent',
      visibility: 'FollowersOnly',
    });
  });

  it('fans address out to city/street/street_number when address is provided', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(
      client,
      'p_1',
      {
        address: { city: 'IL-002', cityName: 'Haifa', street: 'Herzl', streetNumber: '7' },
      },
      async () => FAKE_POST,
    );
    expect(calls.postsUpdates[0]?.row).toEqual({
      city: 'IL-002',
      street: 'Herzl',
      street_number: '7',
    });
  });

  it('preserves explicit null on description / itemCondition / urgency (vs. undefined which skips)', async () => {
    const { client, calls } = makeFakeClient({});
    await executePostUpdate(
      client,
      'p_1',
      { description: null, itemCondition: null, urgency: null },
      async () => FAKE_POST,
    );
    expect(calls.postsUpdates[0]?.row).toEqual({
      description: null,
      item_condition: null,
      urgency: null,
    });
  });

  it('maps visibility_downgrade_forbidden in the error message to PostError("visibility_downgrade_forbidden")', async () => {
    const { client } = makeFakeClient({
      postsUpdateError: { message: 'visibility_downgrade_forbidden: cannot' },
    });
    await expect(
      executePostUpdate(client, 'p_1', { title: 't' }, async () => FAKE_POST),
    ).rejects.toMatchObject({ name: 'PostError', code: 'visibility_downgrade_forbidden' });
  });

  it('wraps any other update error in a plain Error with the "update: " prefix', async () => {
    const { client } = makeFakeClient({ postsUpdateError: { message: 'rls denied' } });
    await expect(
      executePostUpdate(client, 'p_1', { title: 't' }, async () => FAKE_POST),
    ).rejects.toThrow('update: rls denied');
  });
});

// Media-patch branches are covered in executePostUpdate.media.test.ts
// (split to keep each test file under the 200-LOC arch cap).
