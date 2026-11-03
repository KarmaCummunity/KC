import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostWithOwner } from '@kc/application';
import {
  applyPostActorIdentityProjectionBatch,
  fetchFollowedTargets,
  fetchPostActorIdentitiesByPostIds,
} from '../applyPostActorIdentityProjection';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makePost(postId: string, ownerId: string, recipientUserId?: string): PostWithOwner {
  return {
    postId,
    ownerId,
    ownerName: 'Owner Name',
    ownerHandle: 'owner_handle',
    ownerAvatarUrl: 'https://example.com/owner.png',
    visibility: 'Public',
    createdAt: '2026-01-01T00:00:00.000Z',
    recipientUser: recipientUserId
      ? {
          userId: recipientUserId,
          displayName: 'Recipient Name',
          shareHandle: 'rec_handle',
          avatarUrl: 'https://example.com/rec.png',
        }
      : null,
    recipient: recipientUserId
      ? {
          postId,
          recipientUserId,
          markedAt: '2026-01-02T00:00:00.000Z',
        }
      : null,
  } as unknown as PostWithOwner;
}

describe('applyPostActorIdentityProjection — helpers and branches', () => {
  describe('fetchFollowedTargets', () => {
    it('returns empty set immediately when candidateIds is empty', async () => {
      const client = { from: vi.fn() } as unknown as SupabaseClient<any>;
      const set = await fetchFollowedTargets(client, 'u_viewer', []);
      expect(set.size).toBe(0);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('queries follow_edges and populates set of followed_ids', async () => {
      const inMock = vi.fn().mockResolvedValue({
        data: [{ followed_id: 'u_1' }, { followed_id: 'u_2' }],
        error: null,
      });
      const eqMock = vi.fn().mockReturnValue({ in: inMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      const fromMock = vi.fn().mockReturnValue({ select: selectMock });
      const client = { from: fromMock } as unknown as SupabaseClient<any>;

      const set = await fetchFollowedTargets(client, 'u_viewer', ['u_1', 'u_2', 'u_3']);
      expect(fromMock).toHaveBeenCalledWith('follow_edges');
      expect(eqMock).toHaveBeenCalledWith('follower_id', 'u_viewer');
      expect(inMock).toHaveBeenCalledWith('followed_id', ['u_1', 'u_2', 'u_3']);
      expect(set.has('u_1')).toBe(true);
      expect(set.has('u_2')).toBe(true);
      expect(set.has('u_3')).toBe(false);
    });

    it('throws when follow_edges query fails', async () => {
      const inMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'db error' },
      });
      const eqMock = vi.fn().mockReturnValue({ in: inMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      const fromMock = vi.fn().mockReturnValue({ select: selectMock });
      const client = { from: fromMock } as unknown as SupabaseClient<any>;

      await expect(fetchFollowedTargets(client, 'u_viewer', ['u_1'])).rejects.toThrow(
        'fetchFollowedTargets: db error',
      );
    });
  });

  describe('fetchPostActorIdentitiesByPostIds', () => {
    it('returns empty map when postIds is empty', async () => {
      const client = { from: vi.fn() } as unknown as SupabaseClient<any>;
      const map = await fetchPostActorIdentitiesByPostIds(client, []);
      expect(map.size).toBe(0);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('populates nested map from query result', async () => {
      const rows = [
        {
          post_id: 'p_1',
          user_id: 'u_owner',
          identity_visibility: 'FollowersOnly',
          hide_from_counterparty: false,
          surface_visibility: 'FollowersOnly',
          updated_at: '2026-01-01',
        },
        {
          post_id: 'p_1',
          user_id: 'u_rec',
          identity_visibility: 'Hidden',
          hide_from_counterparty: true,
          surface_visibility: 'OnlyMe',
          updated_at: '2026-01-01',
        },
      ];
      const inMock = vi.fn().mockResolvedValue({ data: rows, error: null });
      const selectMock = vi.fn().mockReturnValue({ in: inMock });
      const fromMock = vi.fn().mockReturnValue({ select: selectMock });
      const client = { from: fromMock } as unknown as SupabaseClient<any>;

      const map = await fetchPostActorIdentitiesByPostIds(client, ['p_1']);
      expect(map.get('p_1')?.get('u_owner')?.identity_visibility).toBe('FollowersOnly');
      expect(map.get('p_1')?.get('u_rec')?.hide_from_counterparty).toBe(true);
    });

    it('returns empty map when relation is missing (PGRST205)', async () => {
      const inMock = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST205', message: 'relation missing' },
      });
      const selectMock = vi.fn().mockReturnValue({ in: inMock });
      const fromMock = vi.fn().mockReturnValue({ select: selectMock });
      const client = { from: fromMock } as unknown as SupabaseClient<any>;

      const map = await fetchPostActorIdentitiesByPostIds(client, ['p_1']);
      expect(map.size).toBe(0);
    });

    it('throws when select query fails with non-PGRST error', async () => {
      const inMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation lock error' },
      });
      const selectMock = vi.fn().mockReturnValue({ in: inMock });
      const fromMock = vi.fn().mockReturnValue({ select: selectMock });
      const client = { from: fromMock } as unknown as SupabaseClient<any>;

      await expect(fetchPostActorIdentitiesByPostIds(client, ['p_1'])).rejects.toThrow(
        'fetchPostActorIdentitiesByPostIds: relation lock error',
      );
    });
  });

  describe('applyPostActorIdentityProjectionBatch — recipient & exposure policies', () => {
    it('masks recipient from third-party viewer when hide_from_counterparty is true', async () => {
      const post = makePost('p_1', 'u_owner', 'u_rec');
      const identityRows = [
        {
          post_id: 'p_1',
          user_id: 'u_rec',
          identity_visibility: 'Public',
          hide_from_counterparty: true,
          surface_visibility: 'Public',
          updated_at: '2026-01-01',
        },
      ];

      const client = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [], error: null }),
            }),
            in: async () =>
              table === 'post_actor_identity'
                ? { data: identityRows, error: null }
                : { data: [], error: null },
          }),
        }),
      } as unknown as SupabaseClient<any>;

      const [projected] = await applyPostActorIdentityProjectionBatch(
        client,
        [post],
        'u_stranger', // third-party viewer
      );

      expect(projected?.recipientUser?.displayName).toBe('');
      expect(projected?.recipientUser?.shareHandle).toBe('');
      expect(projected?.recipientProfileNavigableFromPost).toBe(false);
    });

    it('never masks recipient from counterparty (post owner)', async () => {
      const post = makePost('p_1', 'u_owner', 'u_rec');
      const identityRows = [
        {
          post_id: 'p_1',
          user_id: 'u_rec',
          identity_visibility: 'Public',
          hide_from_counterparty: true,
          surface_visibility: 'OnlyMe',
          updated_at: '2026-01-01',
        },
      ];

      const client = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [], error: null }),
            }),
            in: async () =>
              table === 'post_actor_identity'
                ? { data: identityRows, error: null }
                : { data: [], error: null },
          }),
        }),
      } as unknown as SupabaseClient<any>;

      // Viewer is the post owner (the counterparty of the recipient)
      const [projected] = await applyPostActorIdentityProjectionBatch(
        client,
        [post],
        'u_owner',
      );

      expect(projected?.recipientUser?.displayName).toBe('Recipient Name');
      expect(projected?.recipientProfileNavigableFromPost).toBe(true);
    });

    it('shows recipient to follower when exposure is FollowersOnly', async () => {
      const post = makePost('p_1', 'u_owner', 'u_rec');
      const identityRows = [
        {
          post_id: 'p_1',
          user_id: 'u_rec',
          identity_visibility: 'FollowersOnly',
          hide_from_counterparty: false,
          surface_visibility: 'Public',
          updated_at: '2026-01-01',
        },
      ];

      const client = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ followed_id: 'u_rec' }],
                error: null,
              }),
            }),
            in: async () =>
              table === 'post_actor_identity'
                ? { data: identityRows, error: null }
                : { data: [{ followed_id: 'u_rec' }], error: null },
          }),
        }),
      } as unknown as SupabaseClient<any>;

      const [projected] = await applyPostActorIdentityProjectionBatch(
        client,
        [post],
        'u_follower',
      );

      expect(projected?.recipientUser?.displayName).toBe('Recipient Name');
      expect(projected?.recipientProfileNavigableFromPost).toBe(true);
    });

    it('handles custom identityListingHostUserId option', async () => {
      const post = makePost('p_1', 'u_owner', 'u_rec');
      const client = {
        from: () => ({
          select: () => ({
            eq: () => ({ in: async () => ({ data: [], error: null }) }),
            in: async () => ({ data: [], error: null }),
          }),
        }),
      } as unknown as SupabaseClient<any>;

      const [projected] = await applyPostActorIdentityProjectionBatch(
        client,
        [post],
        'u_viewer',
        { identityListingHostUserId: 'u_host' },
      );

      expect(projected?.postId).toBe('p_1');
    });
  });
});
