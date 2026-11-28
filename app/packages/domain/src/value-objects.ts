// ─────────────────────────────────────────────
// VALUE OBJECTS — Karma Community Domain Layer
// Mapped to SRS Part III § 3.3
// ─────────────────────────────────────────────

import { ValidationError } from './errors';
import type { NotificationKind } from './notifications';

// ── Authentication ────────────────────────────

/** How the member signed in (auth identity provider). */
export type AuthProvider = 'google' | 'apple' | 'phone' | 'email';

/** Client runtime for the session or device event. */
export type Platform = 'ios' | 'android' | 'web';

// ── User ──────────────────────────────────────

/** Profile visibility to non-followers (`Private` hides from them). */
export type PrivacyMode = 'Public' | 'Private';

/** Account lifecycle. `pending_deletion` restorable until purge (FR-AUTH-016). */
export type AccountStatus =
  | 'pending_verification'
  | 'active'
  | 'suspended_for_false_reports'
  | 'suspended_admin'
  | 'banned'
  | 'pending_deletion';

/** Onboarding progress: basic info → avatar → completed. */
export type OnboardingState =
  | 'pending_basic_info'
  | 'pending_avatar'
  | 'completed';

// ── Post ──────────────────────────────────────

/** Listing direction: offer (`Give`) or ask (`Request`). */
export type PostType = 'Give' | 'Request';

/** Listing lifecycle. `draft` unpublished; `paused` owner-only (D104 / G1). */
export type PostStatus =
  // draft → open (baseline machine).
  | 'draft'
  | 'open'
  | 'closed_delivered'
  | 'deleted_no_recipient'
  | 'expired'
  | 'removed_admin'
  // D33/D61 — 3 reports hide until admin restores/removes.
  | 'hidden_pending_review'
  // D104 — owner paused; owner-only (G1, migration 0551).
  | 'paused';

/** Who may see a published listing beyond RLS. */
export type PostVisibility = 'Public' | 'FollowersOnly' | 'OnlyMe';

/** How much address is shown on a listing card or detail. */
export type LocationDisplayLevel = 'CityOnly' | 'CityAndStreet' | 'FullAddress';

/** Physical condition of a Give item. */
export type ItemCondition = 'New' | 'LikeNew' | 'Good' | 'Fair' | 'Damaged';

/** Give-post condition picker order (create/edit UI, post detail). */
export const ITEM_CONDITIONS: ItemCondition[] = [
  'New', 'LikeNew', 'Good', 'Fair', 'Damaged',
];

/** Legacy item category for Give/Request listings. */
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

/** Ordered list of every {@link Category} for pickers and filters. */
export const ALL_CATEGORIES: Category[] = [
  'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear',
  'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other',
];

// ── Chat ──────────────────────────────────────

/** Kind of a chat message payload. */
export type MessageKind = 'user' | 'system' | 'media';

/** Delivery/read state of a chat message. */
export type MessageStatus = 'pending' | 'delivered' | 'read';

/** Chat message reaction (KC#873); one per member per message. */
export type MessageReactionType = 'like' | 'love' | 'laugh' | 'sad';

/** Reaction types in picker order. */
export const MESSAGE_REACTION_TYPES: readonly MessageReactionType[] = ['like', 'love', 'laugh', 'sad'];

/** Narrows an untrusted value to a known {@link MessageReactionType}. */
export function isMessageReactionType(value: unknown): value is MessageReactionType {
  return typeof value === 'string' && (MESSAGE_REACTION_TYPES as readonly string[]).includes(value);
}

// ── Follow ────────────────────────────────────

/** Status of a follow request between two members. */
export type FollowRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

// ── Moderation ────────────────────────────────

/** Reason selected when filing a moderation report. */
export type ReportReason = 'Spam' | 'Offensive' | 'Misleading' | 'Illegal' | 'Other';

/**
 * Report target. DB accepts post/user/comment/chat; `listing` aliases `post`.
 * No target-less report in the baseline.
 */
export type ReportTargetType = 'post' | 'user' | 'chat' | 'comment' | 'listing';

/** Outcome of a moderation report case. */
export type ReportStatus = 'open' | 'confirmed_violation' | 'dismissed_no_violation';

/** Why a post or user was auto-queued for admin review. */
export type QueueReason = 'excessive_reopens' | 'forbidden_keyword' | 'manual_flag';

// ── Feed (FR-FEED-004, 006) ──────────────────

/** Feed sort modes (FR-FEED-006). */
export type FeedSortOrder = 'newest' | 'oldest' | 'distance' | 'personalized';

/** Feed filter by listing open/closed state (FR-FEED-004). */
export type FeedStatusFilter = 'open' | 'closed' | 'all';

/** Geographic feed filter. Invariant: `radiusKm` > 0. */
export interface LocationFilter {
  readonly centerCity: string;        // city_id (CBS code or slug)
  readonly centerCityName: string;    // display name; UI-only — never sent to repo
  readonly radiusKm: number;          // > 0
}

/** Canonical FilterSheet radius options (FR-FEED-004); UI imports this list. */
export const RADIUS_OPTIONS_KM: readonly number[] = [5, 10, 25, 50, 100] as const;

// ── Address value object ──────────────────────

/** Street address. `city` is a slug; `cityName` is the stored display label. */
export interface Address {
  readonly city: string;
  readonly cityName: string;
  readonly street: string;
  readonly streetNumber: string;
}

/**
 * Builds an {@link Address}; requires non-empty `city` and `cityName`.
 * @throws {ValidationError} when `city` or `cityName` is empty
 */
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

/** Street number: digits + optional Latin/Hebrew letter (mirrors `0081`). */
export const STREET_NUMBER_PATTERN = /^[0-9]+[A-Za-z\u05D0-\u05EA]?$/;
/** Email with 2+ alphabetic TLD; Supabase Auth is the source of truth. */
export const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ── Notification preferences ──────────────────

/** Quiet-hours window for non-critical notifications (`HH:mm` + IANA tz). */
export interface QuietHoursPreferences {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
}

/** Per-kind opt-outs (§7.11). Enabled unless `false`; missing keys keep category default. */
export type NotificationKindPreferences = Partial<Record<NotificationKind, boolean>>;

/** Member notification prefs (category toggles, quiet hours, per-kind map). */
export interface NotificationPreferences {
  critical: boolean;
  social: boolean;
  quietHours?: QuietHoursPreferences;
  kinds?: NotificationKindPreferences;
}

// ── Donations ─────────────────────────────────
// FR-DONATE-006..009. Slugs mirror CHECK on donation_categories.slug.

/** Donation category slug (`donation_categories.slug` CHECK). */
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

/** Ordered list of every {@link DonationCategorySlug}. */
export const DONATION_CATEGORY_SLUGS: readonly DonationCategorySlug[] = [
  'time', 'money', 'food', 'housing', 'transport', 'knowledge', 'animals', 'medical',
  'democracy', 'employment', 'challenges',
] as const;

/** Min donation-link display name length (CHECK in `0014`). */
export const DONATION_LINK_DISPLAY_NAME_MIN = 2;
/** Max donation-link display name length (CHECK in `0014`). */
export const DONATION_LINK_DISPLAY_NAME_MAX = 80;
/** Max donation-link description length (CHECK in `0014`). */
export const DONATION_LINK_DESCRIPTION_MAX = 280;
/** Donation-link URL must be http(s) (CHECK in `0014`). */
export const DONATION_LINK_URL_PATTERN = /^https?:\/\//i;

// ── Biography (FR-PROFILE-007 AC3 / FR-PROFILE-014) ───────────────────
// `BIOGRAPHY_URL_PATTERN_SOURCE` mirrored in Postgres CHECK
// `users_biography_check` (`biography_url_check_real_tlds`, KC#1721).
// Edit both; grammar is JS/Postgres-compatible (no \b / lookarounds).

/** Max biography character length (FR-PROFILE-007 AC3). */
export const BIOGRAPHY_MAX_LENGTH = 200;

/** TLDs that turn a dotted word into a link (vs "Node.js" / "Dr.Smith"). */
const BIOGRAPHY_LINK_TLDS = [
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'ly', 'gl', 'gd', 'gy', 'ee', 'app',
  'dev', 'xyz', 'link', 'site', 'online', 'shop', 'store', 'live', 'tv', 'gg', 'ai',
  'il', 'uk', 'de', 'fr', 'ru', 'eu', 'ca', 'au',
] as const;

/** Source for biography URL detection: http(s), `www.`, or bare link TLD. */
export const BIOGRAPHY_URL_PATTERN_SOURCE =
  '(https?://|www\\.|(^|[^a-z0-9_-])[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(' +
  BIOGRAPHY_LINK_TLDS.join('|') +
  ')([^a-z0-9-]|$))';

/** Compiled {@link BIOGRAPHY_URL_PATTERN_SOURCE} (case-insensitive). */
export const BIOGRAPHY_URL_PATTERN = new RegExp(BIOGRAPHY_URL_PATTERN_SOURCE, 'i');

/** FR-PROFILE-014 — true when text has http(s), `www.`, or a bare domain. */
export function containsBiographyUrl(text: string): boolean {
  return BIOGRAPHY_URL_PATTERN.test(text);
}
