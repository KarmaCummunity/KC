import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseFollowSuggestionsRepository } from '../SupabaseFollowSuggestionsRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

function repo(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { r: new SupabaseFollowSuggestionsRepository({ rpc } as unknown as SupabaseClient<any>), rpc };
}

describe('SupabaseFollowSuggestionsRepository', () => {
  it('listSuggestions maps rows and uses default limit', async () => {
    const { r, rpc } = repo({
      data: [
        {
          user_id: 'u1',
          display_name: 'A',
          share_handle: 'a',
          avatar_url: null,
          city_name: 'TLV',
          followers_count: 3,
          reason: 'mutual',
          verification_level: 1,
        },
      ],
      error: null,
    });
    await expect(r.listSuggestions()).resolves.toEqual([
      {
        userId: 'u1', displayName: 'A', shareHandle: 'a', avatarUrl: null, cityName: 'TLV', followersCount: 3,
        reason: 'mutual', verificationLevel: 1,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('rpc_follow_suggestions', { p_limit: 15 });
  });

  it('listSuggestions handles null data and errors', async () => {
    await expect(repo({ data: null, error: null }).r.listSuggestions(3)).resolves.toEqual([]);
    await expect(repo({ data: null, error: { message: 'nope' } }).r.listSuggestions()).rejects.toThrow(
      'listSuggestions: nope',
    );
  });

  it('getProfileCompleteness maps payload with and without user id', async () => {
    const { r, rpc } = repo({
      data: { score: 60, missing: null, verified: true, showVerifiedBadge: true },
      error: null,
    });
    await expect(r.getProfileCompleteness()).resolves.toEqual({
      score: 60,
      missing: [],
      verified: true,
      showVerifiedBadge: true,
    });
    expect(rpc).toHaveBeenLastCalledWith('rpc_profile_completeness', {});
    await r.getProfileCompleteness('u9');
    expect(rpc).toHaveBeenLastCalledWith('rpc_profile_completeness', { p_user_id: 'u9' });
    await expect(repo({ data: null, error: { message: 'x' } }).r.getProfileCompleteness()).rejects.toThrow(
      'getProfileCompleteness: x',
    );
  });
});
