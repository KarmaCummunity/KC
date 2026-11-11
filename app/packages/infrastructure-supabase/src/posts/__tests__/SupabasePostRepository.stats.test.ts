import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabasePostRepository } from '../SupabasePostRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('SupabasePostRepository - stats and actor identity methods', () => {
  it('delegates listPostActorIdentities to listPostActorIdentitiesForPost', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: 'p_1',
          user_id: 'u_1',
          surface_visibility: 'Public',
          hide_from_counterparty: false,
        },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<Database>;

    const repo = new SupabasePostRepository(client);
    const rows = await repo.listPostActorIdentities('p_1');

    expect(from).toHaveBeenCalledWith('post_actor_identity');
    expect(rows).toEqual([
      {
        postId: 'p_1',
        userId: 'u_1',
        surfaceVisibility: 'Public',
        hideFromCounterparty: false,
      },
    ]);
  });

  it('delegates upsertPostActorIdentity to upsertPostActorIdentityRow', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    const repo = new SupabasePostRepository(client);
    await repo.upsertPostActorIdentity({
      postId: 'p_1',
      userId: 'u_1',
      surfaceVisibility: 'OnlyMe',
      hideFromCounterparty: true,
    });

    expect(rpc).toHaveBeenCalledWith('upsert_post_actor_identity', {
      p_post_id: 'p_1',
      p_surface_visibility: 'OnlyMe',
      p_hide_from_counterparty: true,
    });
  });

  it('delegates countProfileOpenPosts to countProfileOpenPostsQuery', async () => {
    const builder: any = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ count: 4, error: null }).then(resolve, reject),
    };
    const select = vi.fn().mockReturnValue(builder);
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<Database>;

    const repo = new SupabasePostRepository(client);
    const count = await repo.countProfileOpenPosts('u_owner', { excludeOnlyMe: true });

    expect(count).toBe(4);
    expect(builder.neq).toHaveBeenCalledWith('visibility', 'OnlyMe');
  });

  it('delegates countProfileClosedPosts to countProfileClosedPostsQuery', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 6, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    const repo = new SupabasePostRepository(client);
    const count = await repo.countProfileClosedPosts('u_profile', 'u_viewer');

    expect(rpc).toHaveBeenCalledWith('profile_closed_posts_count', {
      p_profile_user_id: 'u_profile',
      p_viewer_user_id: 'u_viewer',
      p_list_mode: 'standard',
    });
    expect(count).toBe(6);
  });
});
