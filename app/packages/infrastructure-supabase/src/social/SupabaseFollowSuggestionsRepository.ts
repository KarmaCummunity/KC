// KC#871 — follow suggestions + profile completeness.
//
// The baseline has neither a suggestion query (M03) nor a completeness function (M04), and this
// adapter does not invent one: both reads report the capability as missing, so the suggestions
// screen shows its empty state and no completeness nudge. No call is made. When the social-graph
// module gains the functions, the two methods call them through `unwrapCall`.

import { BackendUnavailableError, type VerificationLevel } from '@kc/domain';

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
  /** M03 — no suggestion query in the baseline. */
  listSuggestions(_limit = 15): Promise<FollowSuggestionRow[]> {
    return Promise.reject(new BackendUnavailableError('rpc:rpc_follow_suggestions', 'function'));
  }

  /** M04 — no completeness function in the baseline. */
  getProfileCompleteness(_userId?: string): Promise<ProfileCompleteness> {
    return Promise.reject(new BackendUnavailableError('rpc:rpc_profile_completeness', 'function'));
  }
}
