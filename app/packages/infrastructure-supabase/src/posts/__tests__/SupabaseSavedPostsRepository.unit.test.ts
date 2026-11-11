import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabaseSavedPostsRepository } from '../SupabaseSavedPostsRepository';
import {
  isPostSavedRow,
  listSavedPostsPage,
  savePostRow,
  unsavePostRow,
} from '../savedPostsMethods';
import { encodeSavedPostsCursor } from '../savedPostsCursor';

/* eslint-disable @typescript-eslint/no-explicit-any */

const POST_ROW = {
  post_id: 'p_1',
  owner_id: 'u_owner',
  type: 'Give',
  status: 'open',
  visibility: 'Public',
  title: 'Saved Item',
  description: 'Desc',
  category: 'Furniture',
  city: '5000',
  street: null,
  street_number: null,
  location_display_level: 'CityOnly',
  item_condition: 'Good',
  urgency: 'Normal',
  reopen_count: 0,
  delete_after: null,
  created_at: '2026-05-16T12:00:00.000Z',
  updated_at: '2026-05-16T12:00:00.000Z',
};

function createMockClient(overrides: {
  userId?: string | null;
  getUserError?: any;
  upsertResult?: { error: any };
  deleteResult?: { error: any };
  selectMaybeSingleResult?: { data: any; error: any };
  listQueryResult?: { data: any; error: any };
} = {}) {
  const calls: {
    upsert?: { table: string; payload: any; options: any };
    delete?: { table: string; filterCol?: string; filterVal?: any };
    select?: { table: string; columns: string };
    ltArgs?: [string, any];
  } = {};

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: overrides.userId ? { id: overrides.userId } : null },
        error: overrides.getUserError ?? null,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      return {
        upsert: vi.fn().mockImplementation((payload: any, options: any) => {
          calls.upsert = { table, payload, options };
          return Promise.resolve(overrides.upsertResult ?? { error: null });
        }),
        delete: vi.fn().mockImplementation(() => {
          calls.delete = { table };
          return {
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              calls.delete!.filterCol = col;
              calls.delete!.filterVal = val;
              return Promise.resolve(overrides.deleteResult ?? { error: null });
            }),
          };
        }),
        select: vi.fn().mockImplementation((columns: string) => {
          calls.select = { table, columns };
          const queryBuilder: any = {
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lt: vi.fn().mockImplementation((col: string, val: any) => {
              calls.ltArgs = [col, val];
              return queryBuilder;
            }),
            maybeSingle: vi.fn().mockResolvedValue(
              overrides.selectMaybeSingleResult ?? { data: null, error: null },
            ),
            then: (resolve: any, reject: any) => {
              const res = overrides.listQueryResult ?? { data: [], error: null };
              return Promise.resolve(res).then(resolve, reject);
            },
          };
          return queryBuilder;
        }),
      };
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe('savedPostsMethods & SupabaseSavedPostsRepository', () => {
  describe('savePostRow', () => {
    it('throws when user is not authenticated', async () => {
      const { client } = createMockClient({ userId: null });
      await expect(savePostRow(client, 'p_1')).rejects.toThrow('saved_posts: not authenticated');
    });

    it('upserts saved_posts with user_id and post_id', async () => {
      const { client, calls } = createMockClient({ userId: 'u_123' });
      await savePostRow(client, 'p_1');

      expect(calls.upsert).toEqual({
        table: 'saved_posts',
        payload: { user_id: 'u_123', post_id: 'p_1' },
        options: { onConflict: 'user_id,post_id', ignoreDuplicates: true },
      });
    });

    it('throws with error message on DB failure', async () => {
      const { client } = createMockClient({
        userId: 'u_123',
        upsertResult: { error: { message: 'db error' } },
      });
      await expect(savePostRow(client, 'p_1')).rejects.toThrow('savePost: db error');
    });
  });

  describe('unsavePostRow', () => {
    it('deletes saved_posts row matching post_id', async () => {
      const { client, calls } = createMockClient();
      await unsavePostRow(client, 'p_1');

      expect(calls.delete).toEqual({
        table: 'saved_posts',
        filterCol: 'post_id',
        filterVal: 'p_1',
      });
    });

    it('throws with error message on DB failure', async () => {
      const { client } = createMockClient({
        deleteResult: { error: { message: 'permission denied' } },
      });
      await expect(unsavePostRow(client, 'p_1')).rejects.toThrow('unsavePost: permission denied');
    });
  });

  describe('isPostSavedRow', () => {
    it('returns true when row exists', async () => {
      const { client } = createMockClient({
        selectMaybeSingleResult: { data: { post_id: 'p_1' }, error: null },
      });
      const result = await isPostSavedRow(client, 'p_1');
      expect(result).toBe(true);
    });

    it('returns false when row does not exist', async () => {
      const { client } = createMockClient({
        selectMaybeSingleResult: { data: null, error: null },
      });
      const result = await isPostSavedRow(client, 'p_1');
      expect(result).toBe(false);
    });

    it('throws on query error', async () => {
      const { client } = createMockClient({
        selectMaybeSingleResult: { data: null, error: { message: 'bad query' } },
      });
      await expect(isPostSavedRow(client, 'p_1')).rejects.toThrow('isPostSaved: bad query');
    });
  });

  describe('listSavedPostsPage', () => {
    it('throws when user is not authenticated', async () => {
      const { client } = createMockClient({ userId: null });
      await expect(listSavedPostsPage(client, 10)).rejects.toThrow('saved_posts: not authenticated');
    });

    it('queries and maps posts within safe limit without pagination cursor', async () => {
      const rows = [
        { saved_at: '2026-05-16T12:00:00.000Z', post_id: 'p_1', posts: POST_ROW },
        { saved_at: '2026-05-15T12:00:00.000Z', post_id: 'p_2', posts: null }, // orphaned/deleted post
      ];
      const { client } = createMockClient({
        userId: 'u_123',
        listQueryResult: { data: rows, error: null },
      });

      const result = await listSavedPostsPage(client, 10);
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0]?.postId).toBe('p_1');
      expect(result.nextCursor).toBeNull();
    });

    it('paginates when rows exceed safeLimit and provides nextCursor', async () => {
      const rows = [
        { saved_at: '2026-05-16T12:00:00.000Z', post_id: 'p_1', posts: { ...POST_ROW, post_id: 'p_1' } },
        { saved_at: '2026-05-15T12:00:00.000Z', post_id: 'p_2', posts: { ...POST_ROW, post_id: 'p_2' } },
      ];
      const { client } = createMockClient({
        userId: 'u_123',
        listQueryResult: { data: rows, error: null },
      });

      const result = await listSavedPostsPage(client, 1);
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0]?.postId).toBe('p_1');
      expect(result.nextCursor).toBeTruthy();
    });

    it('applies decoded cursor filter when valid cursor is provided', async () => {
      const cursor = encodeSavedPostsCursor({ savedAt: '2026-05-15T00:00:00.000Z' });
      const { client, calls } = createMockClient({
        userId: 'u_123',
        listQueryResult: { data: [], error: null },
      });

      await listSavedPostsPage(client, 10, cursor);
      expect(calls.ltArgs).toEqual(['saved_at', '2026-05-15T00:00:00.000Z']);
    });

    it('throws on query failure', async () => {
      const { client } = createMockClient({
        userId: 'u_123',
        listQueryResult: { data: null, error: { message: 'db query failed' } },
      });
      await expect(listSavedPostsPage(client, 10)).rejects.toThrow('listSavedPosts: db query failed');
    });
  });

  describe('SupabaseSavedPostsRepository class methods', () => {
    it('delegates savePost, unsavePost, isPostSaved, and listSavedPosts', async () => {
      const { client } = createMockClient({
        userId: 'u_123',
        selectMaybeSingleResult: { data: { post_id: 'p_1' }, error: null },
        listQueryResult: { data: [], error: null },
      });
      const repo = new SupabaseSavedPostsRepository(client);

      await expect(repo.savePost('p_1')).resolves.toBeUndefined();
      await expect(repo.unsavePost('p_1')).resolves.toBeUndefined();
      await expect(repo.isPostSaved('p_1')).resolves.toBe(true);
      await expect(repo.listSavedPosts(10)).resolves.toEqual({ posts: [], nextCursor: null });
    });
  });
});
