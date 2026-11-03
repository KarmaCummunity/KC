import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPostActorIdentitiesForPost,
  upsertPostActorIdentityRow,
} from '../postActorIdentityMethods';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('upsertPostActorIdentityRow', () => {
  it('calls upsert_post_actor_identity RPC with mapped args (0160 / TD-85)', async () => {
    const rpcCalls: Array<{ name: string; params: unknown }> = [];
    const client = {
      rpc: (name: string, params: unknown) => {
        rpcCalls.push({ name, params });
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as SupabaseClient<any>;

    await upsertPostActorIdentityRow(client, {
      postId: 'p_1',
      userId: 'u_1',
      surfaceVisibility: 'OnlyMe',
      hideFromCounterparty: true,
    });

    expect(rpcCalls).toEqual([
      {
        name: 'upsert_post_actor_identity',
        params: {
          p_post_id: 'p_1',
          p_surface_visibility: 'OnlyMe',
          p_hide_from_counterparty: true,
        },
      },
    ]);
  });

  it('silently ignores relation missing errors (PGRST205)', async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'not found' } }),
    } as unknown as SupabaseClient<any>;

    await expect(
      upsertPostActorIdentityRow(client, {
        postId: 'p_1',
        userId: 'u_1',
        surfaceVisibility: 'Public',
        hideFromCounterparty: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws when RPC returns an error', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({ data: null, error: { message: 'forbidden_not_participant' } }),
    } as unknown as SupabaseClient<any>;

    await expect(
      upsertPostActorIdentityRow(client, {
        postId: 'p_1',
        userId: 'u_1',
        surfaceVisibility: 'OnlyMe',
        hideFromCounterparty: true,
      }),
    ).rejects.toThrow('upsertPostActorIdentity: forbidden_not_participant');
  });
});

describe('listPostActorIdentitiesForPost', () => {
  it('queries post_actor_identity and maps rows with parsed visibility', async () => {
    const rows = [
      {
        post_id: 'p_1',
        user_id: 'u_1',
        surface_visibility: 'FollowersOnly',
        hide_from_counterparty: false,
      },
      {
        post_id: 'p_1',
        user_id: 'u_2',
        surface_visibility: 'OnlyMe',
        hide_from_counterparty: true,
      },
      {
        post_id: 'p_1',
        user_id: 'u_3',
        surface_visibility: 'Public',
        hide_from_counterparty: false,
      },
      {
        post_id: 'p_1',
        user_id: 'u_4',
        surface_visibility: 'unexpected_value',
        hide_from_counterparty: false,
      },
    ];

    const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<any>;

    const results = await listPostActorIdentitiesForPost(client, 'p_1');

    expect(from).toHaveBeenCalledWith('post_actor_identity');
    expect(eq).toHaveBeenCalledWith('post_id', 'p_1');
    expect(results).toHaveLength(4);
    expect(results[0]?.surfaceVisibility).toBe('FollowersOnly');
    expect(results[1]?.surfaceVisibility).toBe('OnlyMe');
    expect(results[2]?.surfaceVisibility).toBe('Public');
    expect(results[3]?.surfaceVisibility).toBe('Public'); // fallback for unknown value
  });

  it('returns empty array when relation is missing (PGRST205)', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<any>;

    const results = await listPostActorIdentitiesForPost(client, 'p_1');
    expect(results).toEqual([]);
  });

  it('throws on non-PGRST error', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db connection failed' },
    });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<any>;

    await expect(listPostActorIdentitiesForPost(client, 'p_1')).rejects.toThrow(
      'listPostActorIdentities: db connection failed',
    );
  });
});
