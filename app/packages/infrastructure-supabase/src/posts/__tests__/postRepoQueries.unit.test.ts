import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import {
  countOpenByUser,
  countProfileClosedPosts,
  countProfileOpenPosts,
  countProfilePostsForViewer,
  fetchPostById,
} from '../postRepoQueries';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SAMPLE_POST_ROW = {
  post_id: 'p_100',
  owner_id: 'u_owner',
  type: 'Give',
  status: 'open',
  visibility: 'Public',
  title: 'Test Post',
  description: 'Desc',
  category: 'Appliances',
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

describe('postRepoQueries', () => {
  describe('fetchPostById', () => {
    it('returns mapped Post domain entity on hit', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: SAMPLE_POST_ROW, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const post = await fetchPostById(client, 'p_100');

      expect(from).toHaveBeenCalledWith('posts');
      expect(eq).toHaveBeenCalledWith('post_id', 'p_100');
      expect(post?.postId).toBe('p_100');
      expect(post?.title).toBe('Test Post');
    });

    it('returns null when post is not found', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const post = await fetchPostById(client, 'missing');
      expect(post).toBeNull();
    });

    it('throws with query error message', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'db failure' } });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      await expect(fetchPostById(client, 'p_100')).rejects.toThrow('fetchPostById: db failure');
    });
  });

  describe('countOpenByUser', () => {
    it('returns exact count of open posts', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: 5, error: null }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const count = await countOpenByUser(client, 'u_1');

      expect(from).toHaveBeenCalledWith('posts');
      expect(select).toHaveBeenCalledWith('post_id', { count: 'exact', head: true });
      expect(builder.eq).toHaveBeenCalledWith('owner_id', 'u_1');
      expect(builder.eq).toHaveBeenCalledWith('status', 'open');
      expect(count).toBe(5);
    });

    it('returns 0 when count is null', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: null, error: null }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const count = await countOpenByUser(client, 'u_1');
      expect(count).toBe(0);
    });

    it('throws on error', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: null, error: { message: 'count failed' } }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      await expect(countOpenByUser(client, 'u_1')).rejects.toThrow('countOpenByUser: count failed');
    });
  });

  describe('countProfilePostsForViewer', () => {
    it('calls active_posts_count_for_viewer RPC and returns count', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      const count = await countProfilePostsForViewer(client, 'u_owner', 'u_viewer');

      expect(rpc).toHaveBeenCalledWith('active_posts_count_for_viewer', {
        p_owner: 'u_owner',
        p_viewer: 'u_viewer',
      });
      expect(count).toBe(7);
    });

    it('defaults to 0 when data is null', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      const count = await countProfilePostsForViewer(client, 'u_owner', null);
      expect(count).toBe(0);
    });

    it('throws on RPC error', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      await expect(countProfilePostsForViewer(client, 'u_owner', null)).rejects.toThrow(
        'countProfilePostsForViewer: rpc error',
      );
    });
  });

  describe('countProfileOpenPosts', () => {
    it('counts open posts of every world, skipping feed-hidden ones, without excludeOnlyMe', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: 3, error: null }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const count = await countProfileOpenPosts(client, 'u_owner');

      expect(from).toHaveBeenCalledWith('posts');
      expect(builder.eq).toHaveBeenCalledWith('owner_id', 'u_owner');
      expect(builder.eq).toHaveBeenCalledWith('feed_hidden', false);
      expect(builder.is).not.toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('status', 'open');
      expect(builder.neq).not.toHaveBeenCalled();
      expect(count).toBe(3);
    });

    it('applies neq("visibility", "OnlyMe") when excludeOnlyMe is true', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: 2, error: null }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      const count = await countProfileOpenPosts(client, 'u_owner', { excludeOnlyMe: true });

      expect(builder.neq).toHaveBeenCalledWith('visibility', 'OnlyMe');
      expect(count).toBe(2);
    });

    it('throws on count failure', async () => {
      const builder: any = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ count: null, error: { message: 'fail' } }).then(resolve, reject),
      };
      const select = vi.fn().mockReturnValue(builder);
      const from = vi.fn().mockReturnValue({ select });
      const client = { from } as unknown as SupabaseClient<Database>;

      await expect(countProfileOpenPosts(client, 'u_owner')).rejects.toThrow(
        'countProfileOpenPosts: fail',
      );
    });
  });

  describe('countProfileClosedPosts', () => {
    it('calls profile_closed_posts_count RPC with standard mode', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: 4, error: null });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      const count = await countProfileClosedPosts(client, 'u_profile', 'u_viewer');

      expect(rpc).toHaveBeenCalledWith('profile_closed_posts_count', {
        p_profile_user_id: 'u_profile',
        p_viewer_user_id: 'u_viewer',
        p_list_mode: 'standard',
      });
      expect(count).toBe(4);
    });

    it('calls profile_closed_posts_count RPC with owner_only_me mode', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      const count = await countProfileClosedPosts(client, 'u_profile', 'u_viewer', 'owner_only_me');

      expect(rpc).toHaveBeenCalledWith('profile_closed_posts_count', {
        p_profile_user_id: 'u_profile',
        p_viewer_user_id: 'u_viewer',
        p_list_mode: 'owner_only_me',
      });
      expect(count).toBe(1);
    });

    it('defaults to 0 if data is not a number', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      const count = await countProfileClosedPosts(client, 'u_profile', null);
      expect(count).toBe(0);
    });

    it('throws on RPC error', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } });
      const client = { rpc } as unknown as SupabaseClient<Database>;

      await expect(countProfileClosedPosts(client, 'u_profile', null)).rejects.toThrow(
        'countProfileClosedPosts: rpc error',
      );
    });
  });
});
