import type { VerificationLevel } from '@kc/domain';

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

/** Follow suggestions and the profile-completeness nudge (KC#871). */
export interface IFollowSuggestionsRepository {
  /** Members worth following; never one the caller follows, has a block with, or who keeps a private profile. */
  listSuggestions(limit?: number): Promise<FollowSuggestionRow[]>;
  /** How complete the caller's own profile is, and what is missing. */
  getProfileCompleteness(): Promise<ProfileCompleteness>;
}
