// ─────────────────────────────────────────────
// SEARCH TYPES — Universal Smart Search
// Mapped to SRS: FR-FEED-017+ (universal search engine)
// ─────────────────────────────────────────────

import type { Category, DonationCategorySlug, PostType } from './value-objects';
import type { VerificationLevel } from './verificationLevel';

// ── Result types ──────────────────────────────

export type SearchResultType = 'post' | 'user' | 'link' | 'org' | 'hashtag';

// ── Sort options ──────────────────────────────

export type SearchSortBy = 'relevance' | 'newest' | 'followers';

// ── Filter interface ──────────────────────────

export interface SearchFilters {
  /** Restrict to a specific result type (null = all). */
  resultType?: SearchResultType | null;
  /** Filter posts by Give/Request. */
  postType?: PostType | null;
  /** Filter posts by category. */
  category?: Category | null;
  /** Filter donation links by donation category slug. */
  donationCategory?: DonationCategorySlug | null;
  /** Filter posts + users by city slug. Links are national — city is ignored. */
  city?: string | null;
  /**
   * Filter posts by distance (km) from the selected `city`. Ignored when
   * `city` is null. The UI exposes this; the infra layer's eq-on-city filter
   * does not yet honor radius — wiring through the `feed_ranked_ids` RPC is
   * tracked as a follow-up. The field is part of `SearchFilters` today so the
   * query-key changes and the value persists across re-opens of the sheet.
   */
  radiusKm?: number | null;
  /** Sort strategy. */
  sortBy?: SearchSortBy;
  /** Filter users by minimum followers. */
  minFollowers?: number | null;
}

// ── User search result ────────────────────────

export interface UserSearchResult {
  readonly userId: string;
  /** Null during the `pending_basic_info` window (migration 0084). UI renders fallback. */
  readonly displayName: string | null;
  readonly shareHandle: string;
  readonly avatarUrl: string | null;
  readonly biography: string | null;
  readonly city: string | null;
  readonly cityName: string | null;
  readonly followersCount: number;
  readonly itemsGivenCount: number;
  /** FR-VERIFY-001 badge; absent = 0. */
  readonly verificationLevel?: VerificationLevel;
}

// ── Donation link search result ───────────────

export interface OrgSearchResult {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
}

export interface HashtagSearchResult {
  readonly tag: string;
  readonly useCount: number;
}

export interface DonationLinkSearchResult {
  readonly id: string;
  readonly categorySlug: DonationCategorySlug;
  readonly url: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly tags: string | null;
}
