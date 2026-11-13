// KC#871 — follow suggestions and the profile-completeness nudge (map rows M03, M04).
// Both are definer reads of migration 0031_member_discovery.sql: suggestions never name a member
// the caller follows, has a block with, or who keeps a private profile; completeness is the
// caller's own only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toVerificationLevel, type VerificationLevel } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

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
    const rows = unwrapCall(
      'rpc:rpc_follow_suggestions',
      await this.client.rpc('rpc_follow_suggestions', { p_limit: limit }),
    );
    return (rows ?? []).map((r) => ({
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

  /** The caller's own profile; another member's is refused by the server. */
  async getProfileCompleteness(): Promise<ProfileCompleteness> {
    const raw = unwrapCall('rpc:rpc_profile_completeness', await this.client.rpc('rpc_profile_completeness', {}));
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      score: typeof row['score'] === 'number' ? row['score'] : 0,
      missing: Array.isArray(row['missing']) ? row['missing'].filter((m): m is string => typeof m === 'string') : [],
      verified: row['verified'] === true,
      showVerifiedBadge: row['showVerifiedBadge'] === true,
    };
  }
}
