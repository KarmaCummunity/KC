// KC#871 — follow suggestions + profile completeness.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toVerificationLevel, type VerificationLevel } from '@kc/domain';
import type { Database } from '../database.types';

export interface FollowSuggestionRow {
  userId: string;
  displayName: string | null;
  shareHandle: string;
  avatarUrl: string | null;
  cityName: string | null;
  followersCount: number;
  reason: string;
  verificationLevel: VerificationLevel;
}

export interface ProfileCompleteness {
  score: number;
  missing: string[];
  verified: boolean;
  showVerifiedBadge: boolean;
}

export class SupabaseFollowSuggestionsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listSuggestions(limit = 15): Promise<FollowSuggestionRow[]> {
    const { data, error } = await this.client.rpc('rpc_follow_suggestions' as never, { p_limit: limit } as never);
    if (error) throw new Error(`listSuggestions: ${error.message}`);
    return ((data ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      share_handle: string;
      avatar_url: string | null;
      city_name: string | null;
      followers_count: number;
      reason: string;
      verification_level?: number | null;
    }>).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      shareHandle: r.share_handle,
      avatarUrl: r.avatar_url,
      cityName: r.city_name,
      followersCount: r.followers_count,
      reason: r.reason,
      verificationLevel: toVerificationLevel(r.verification_level),
    }));
  }

  async getProfileCompleteness(userId?: string): Promise<ProfileCompleteness> {
    const { data, error } = await this.client.rpc(
      'rpc_profile_completeness' as never,
      userId ? ({ p_user_id: userId } as never) : ({} as never),
    );
    if (error) throw new Error(`getProfileCompleteness: ${error.message}`);
    const row = data as unknown as {
      score: number;
      missing: string[];
      verified: boolean;
      showVerifiedBadge: boolean;
    };
    return {
      score: row.score,
      missing: row.missing ?? [],
      verified: row.verified,
      showVerifiedBadge: row.showVerifiedBadge,
    };
  }
}
