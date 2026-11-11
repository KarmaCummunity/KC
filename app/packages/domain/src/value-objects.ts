// ─────────────────────────────────────────────
// VALUE OBJECTS — Karma Community Domain Layer
// Mapped to SRS Part III § 3.3
// ─────────────────────────────────────────────

import { ValidationError } from './errors';
import type { NotificationKind } from './notifications';

// ── Authentication ────────────────────────────

export type AuthProvider = 'google' | 'apple' | 'phone' | 'email';

export type Platform = 'ios' | 'android' | 'web';

// ── User ──────────────────────────────────────

export type PrivacyMode = 'Public' | 'Private';

export type AccountStatus =
  | 'pending_verification'
  | 'active'
  | 'suspended_for_false_reports'
  | 'suspended_admin'
  | 'banned'
  /** FR-AUTH-016: deletion requested, restorable until the purge (the row is then removed). */
  | 'pending_deletion';

export type OnboardingState =
  | 'pending_basic_info'
  | 'pending_avatar'
  | 'completed';

// ── Post ──────────────────────────────────────

export type PostType = 'Give' | 'Request';

export type PostStatus =
  // A post that is saved but not published yet (baseline `post` machine: draft → open).
  | 'draft'
  | 'open'
  | 'closed_delivered'
  | 'deleted_no_recipient'
  | 'expired'
  | 'removed_admin'
  // D33/D61 — 3 reports hide a post until an admin restores or removes it.
  | 'hidden_pending_review'
  // D104 — the owner paused the post: hidden from everyone but the owner (G1, migration 0551).
  | 'paused';

export type PostVisibility = 'Public' | 'FollowersOnly' | 'OnlyMe';

export type LocationDisplayLevel = 'CityOnly' | 'CityAndStreet' | 'FullAddress';

export type ItemCondition = 'New' | 'LikeNew' | 'Good' | 'Fair' | 'Damaged';

/** Give-post condition picker order (create/edit UI, post detail). */
export const ITEM_CONDITIONS: ItemCondition[] = [
  'New', 'LikeNew', 'Good', 'Fair', 'Damaged',
];

export type Category =
  | 'Furniture'
  | 'Clothing'
  | 'Books'
  | 'Toys'
  | 'BabyGear'
  | 'Kitchen'
  | 'Sports'
  | 'Electronics'
  | 'Tools'
  | 'Other';

export const ALL_CATEGORIES: Category[] = [
  'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear',
  'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other',
];

// ── Chat ──────────────────────────────────────

export type MessageKind = 'user' | 'system' | 'media';

export type MessageStatus = 'pending' | 'delivered' | 'read';

// ── Follow ────────────────────────────────────

export type FollowRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

// ── Moderation ────────────────────────────────

export type ReportReason = 'Spam' | 'Offensive' | 'Misleading' | 'Illegal' | 'Other';

/**
 * What a report can be filed against. `reports.target_type` accepts post, user, comment and
 * chat; `listing` is kept as a submission alias of `post` (a listing is a post). There is no
 * general (target-less) report: the baseline has no row for one.
 */
export type ReportTargetType = 'post' | 'user' | 'chat' | 'comment' | 'listing';

export type ReportStatus = 'open' | 'confirmed_violation' | 'dismissed_no_violation';

export type QueueReason = 'excessive_reopens' | 'forbidden_keyword' | 'manual_flag';

// ── Feed (FR-FEED-004, 006) ──────────────────

export type FeedSortOrder = 'newest' | 'oldest' | 'distance' | 'personalized';

export type FeedStatusFilter = 'open' | 'closed' | 'all';

export interface LocationFilter {
  readonly centerCity: string;        // city_id (CBS code or slug)
  readonly centerCityName: string;    // display name; UI-only — never sent to repo
  readonly radiusKm: number;          // > 0
}

// Canonical radius options surfaced in the FilterSheet UI (FR-FEED-004).
// Kept here as the source of truth; UI imports for the slider/picker.
export const RADIUS_OPTIONS_KM: readonly number[] = [5, 10, 25, 50, 100] as const;

// ── Address value object ──────────────────────

export interface Address {
  readonly city: string;   // city slug, e.g. "tel-aviv"
  readonly cityName: string; // display name (Hebrew label as stored), e.g. Tel Aviv
  readonly street: string;
  readonly streetNumber: string;
}

export function createAddress(raw: {
  city: string;
  cityName: string;
  street: string;
  streetNumber: string;
}): Address {
  if (!raw.city) throw new ValidationError('Address: city is required', 'city');
  if (!raw.cityName) throw new ValidationError('Address: cityName is required', 'cityName');
  return { ...raw };
}

// Street number: digits + optional Latin/Hebrew letter (mirrors `0081`).
export const STREET_NUMBER_PATTERN = /^[0-9]+[A-Za-z\u05D0-\u05EA]?$/;
// Email: 2+ char alphabetic TLD; Supabase is the source of truth (audit §3.3).
export const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ── Notification preferences ──────────────────

export interface QuietHoursPreferences {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
}

/**
 * Per-type opt-outs (spec §7.11 "per-type preferences"). A kind is enabled unless it is
 * explicitly `false`; missing keys keep the category default. Stored under `kinds` (0256).
 */
export type NotificationKindPreferences = Partial<Record<NotificationKind, boolean>>;

export interface NotificationPreferences {
  critical: boolean;
  social: boolean;
  quietHours?: QuietHoursPreferences;
  kinds?: NotificationKindPreferences;
}

// ── Donations ─────────────────────────────────
// FR-DONATE-006..009. Slug values mirror the CHECK on donation_categories.slug.

export type DonationCategorySlug =
  | 'time'
  | 'money'
  | 'food'
  | 'housing'
  | 'transport'
  | 'knowledge'
  | 'animals'
  | 'medical'
  | 'democracy'
  | 'employment'
  | 'challenges';

export const DONATION_CATEGORY_SLUGS: readonly DonationCategorySlug[] = [
  'time', 'money', 'food', 'housing', 'transport', 'knowledge', 'animals', 'medical',
  'democracy', 'employment', 'challenges',
] as const;

// Mirrors the CHECK constraints in 0014_donation_categories_and_links.sql.
export const DONATION_LINK_DISPLAY_NAME_MIN = 2;
export const DONATION_LINK_DISPLAY_NAME_MAX = 80;
export const DONATION_LINK_DESCRIPTION_MAX = 280;
export const DONATION_LINK_URL_PATTERN = /^https?:\/\//i;

// ── Biography (FR-PROFILE-007 AC3 / FR-PROFILE-014) ───────────────────
// The same `BIOGRAPHY_URL_PATTERN` source-of-truth is mirrored in the
// Postgres CHECK constraint `users_biography_no_url_check` (migration
// 0073). Edit both together — the regex grammar is intentionally PCRE-
// portable (no JS-only features) so the Postgres-side
// `biography !~* '...'` enforces identical semantics.
export const BIOGRAPHY_MAX_LENGTH = 200;
export const BIOGRAPHY_URL_PATTERN = /(https?:\/\/|www\.|[\w.-]\.[a-z]{2})/i;

/** FR-PROFILE-014 — true when the text contains an http(s) URL, a `www.`
 *  prefix, or a bare token with a TLD-like suffix. Centralised so the
 *  UseCase and any future bio-bearing surface (onboarding, etc.) share
 *  one policy. The server-side CHECK constraint enforces the same
 *  shape on direct inserts. */
export function containsBiographyUrl(text: string): boolean {
  return BIOGRAPHY_URL_PATTERN.test(text);
}
