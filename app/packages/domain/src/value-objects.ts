// ─────────────────────────────────────────────
// VALUE OBJECTS — Karma Community Domain Layer
// Mapped to SRS Part III § 3.3
// ─────────────────────────────────────────────

import { ValidationError } from './errors';
import type { NotificationKind } from './notifications';

// ── Authentication ────────────────────────────

/** How the member signed in (maps to auth identity providers). */
export type AuthProvider = 'google' | 'apple' | 'phone' | 'email';

/** Client runtime the session or device event came from. */
export type Platform = 'ios' | 'android' | 'web';

// ── User ──────────────────────────────────────

/**
 * Profile visibility to non-followers.
 * @invariant `Private` hides the profile from non-followers; `Public` does not.
 */
export type PrivacyMode = 'Public' | 'Private';

/**
 * Lifecycle of a member account (auth + admin + self-deletion).
 * @invariant `pending_deletion` is restorable until purge (FR-AUTH-016); the row is then removed.
 */
export type AccountStatus =
  | 'pending_verification'
  | 'active'
  | 'suspended_for_false_reports'
  | 'suspended_admin'
  | 'banned'
  /** FR-AUTH-016: deletion requested, restorable until the purge (the row is then removed). */
  | 'pending_deletion';

/**
 * Onboarding progress before the member may use the full app.
 * @invariant Order is basic info → avatar → completed.
 */
export type OnboardingState =
  | 'pending_basic_info'
  | 'pending_avatar'
  | 'completed';

// ── Post ──────────────────────────────────────

/** Direction of a listing: offer (`Give`) or ask (`Request`). */
export type PostType = 'Give' | 'Request';

/**
 * Listing lifecycle states (baseline `post` machine + admin/hide/pause).
 * @invariant `draft` is unpublished; `paused` is owner-only visible (D104 / G1).
 */
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

/** Who may see a published listing beyond RLS. */
export type PostVisibility = 'Public' | 'FollowersOnly' | 'OnlyMe';

/** How much of an address is shown on a listing card or detail. */
export type LocationDisplayLevel = 'CityOnly' | 'CityAndStreet' | 'FullAddress';

/** Physical condition of a Give item. */
export type ItemCondition = 'New' | 'LikeNew' | 'Good' | 'Fair' | 'Damaged';

/** Give-post condition picker order (create/edit UI, post detail). */
export const ITEM_CONDITIONS: ItemCondition[] = [
  'New', 'LikeNew', 'Good', 'Fair', 'Damaged',
];

/** Legacy item category enum used by Give/Request listings. */
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

/** Stable ordered list of every {@link Category} for pickers and filters. */
export const ALL_CATEGORIES: Category[] = [
  'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear',
  'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other',
];

// ── Chat ──────────────────────────────────────

/** Kind of a chat message payload. */
export type MessageKind = 'user' | 'system' | 'media';

/** Delivery/read state of a chat message. */
export type MessageStatus = 'pending' | 'delivered' | 'read';

/** A member's reaction to a chat message (KC#873); one per member per message. */
export type MessageReactionType = 'like' | 'love' | 'laugh' | 'sad';

/** Every reaction type, in the order the reaction picker shows them. */
export const MESSAGE_REACTION_TYPES: readonly MessageReactionType[] = ['like', 'love', 'laugh', 'sad'];

/** Narrows an untrusted value (a broadcast payload, a DB row) to a known reaction type. */
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
 * What a report can be filed against. `reports.target_type` accepts post, user, comment and
 * chat; `listing` is kept as a submission alias of `post` (a listing is a post). There is no
 * general (target-less) report: the baseline has no row for one.
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

/**
 * Geographic feed filter: center city plus radius.
 * @invariant `radiusKm` must be > 0.
 */
export interface LocationFilter {
  /** city_id (CBS code or slug) sent to the repo */
  readonly centerCity: string;
  /** Display label; UI-only — never sent to the repo */
  readonly centerCityName: string;
  /** Search radius in kilometres */
  readonly radiusKm: number;
}

/**
 * Canonical radius options for the FilterSheet UI (FR-FEED-004).
 * Source of truth; UI imports for the slider/picker.
 */
export const RADIUS_OPTIONS_KM: readonly number[] = [5, 10, 25, 50, 100] as const;

// ── Address value object ──────────────────────

/**
 * Structured street address for a listing or profile.
 * @invariant `city` is a city slug (e.g. `"tel-aviv"`); `cityName` is the stored display label.
 */
export interface Address {
  /** City slug, e.g. `"tel-aviv"` */
  readonly city: string;
  /** Display name (Hebrew label as stored) */
  readonly cityName: string;
  readonly street: string;
  readonly streetNumber: string;
}

/**
 * Builds an {@link Address}, requiring non-empty `city` and `cityName`.
 * @param raw address fields as entered or loaded
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

/** Street number: digits plus optional Latin/Hebrew letter (mirrors migration `0081`). */
export const STREET_NUMBER_PATTERN = /^[0-9]+[A-Za-z\u05D0-\u05EA]?$/;
/** Email shape with a 2+ alphabetic TLD; Supabase Auth remains the source of truth. */
export const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ── Notification preferences ──────────────────

/** Quiet-hours window for non-critical notifications. */
export interface QuietHoursPreferences {
  /** When false, start/end/timezone are ignored */
  enabled: boolean;
  /** Local start time (`HH:mm`) */
  start: string;
  /** Local end time (`HH:mm`) */
  end: string;
  /** IANA timezone id */
  timezone: string;
}

/**
 * Per-type opt-outs (spec §7.11 "per-type preferences"). A kind is enabled unless it is
 * explicitly `false`; missing keys keep the category default. Stored under `kinds` (0256).
 */
export type NotificationKindPreferences = Partial<Record<NotificationKind, boolean>>;

/**
 * Member notification prefs: category toggles, optional quiet hours, optional per-kind map.
 * @invariant A kind is on unless `kinds[kind] === false`.
 */
export interface NotificationPreferences {
  critical: boolean;
  social: boolean;
  quietHours?: QuietHoursPreferences;
  kinds?: NotificationKindPreferences;
}

// ── Donations ─────────────────────────────────
// FR-DONATE-006..009. Slug values mirror the CHECK on donation_categories.slug.

/**
 * Slug for a donation category row (`donation_categories.slug` CHECK).
 * FR-DONATE-006..009.
 */
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

/** Min length for a donation link display name (CHECK in `0014`). */
export const DONATION_LINK_DISPLAY_NAME_MIN = 2;
/** Max length for a donation link display name (CHECK in `0014`). */
export const DONATION_LINK_DISPLAY_NAME_MAX = 80;
/** Max length for a donation link description (CHECK in `0014`). */
export const DONATION_LINK_DESCRIPTION_MAX = 280;
/** Donation link URL must use http(s) (CHECK in `0014`). */
export const DONATION_LINK_URL_PATTERN = /^https?:\/\//i;

// ── Biography (FR-PROFILE-007 AC3 / FR-PROFILE-014) ───────────────────
// `BIOGRAPHY_URL_PATTERN_SOURCE` is mirrored verbatim in the Postgres CHECK constraint
// `users_biography_check` (migration `biography_url_check_real_tlds`,
// KC#1721). Edit both together: the grammar uses only what JavaScript and Postgres regular
// expressions read the same way (no \b, no lookarounds), and both match case-insensitively.

/** Max biography character length (FR-PROFILE-007 AC3). */
export const BIOGRAPHY_MAX_LENGTH = 200;

/**
 * Top-level domains that make a dotted word a link. A word followed by `.<suffix>` counts as
 * a bare domain only when the suffix is one of these, so "Node.js" or "Dr.Smith" pass while
 * "site.co.il", "bit.ly/x" and "wa.me/…" are flagged. Common generic TLDs, the country TLDs
 * of the shorteners and messaging links, and the country TLDs of KC's audience.
 */
const BIOGRAPHY_LINK_TLDS = [
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'ly', 'gl', 'gd', 'gy', 'ee', 'app',
  'dev', 'xyz', 'link', 'site', 'online', 'shop', 'store', 'live', 'tv', 'gg', 'ai',
  'il', 'uk', 'de', 'fr', 'ru', 'eu', 'ca', 'au',
] as const;

/** http(s)://, a `www.` prefix, or a bare domain: dotted labels ending in a link TLD. */
export const BIOGRAPHY_URL_PATTERN_SOURCE =
  '(https?://|www\\.|(^|[^a-z0-9_-])[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(' +
  BIOGRAPHY_LINK_TLDS.join('|') +
  ')([^a-z0-9-]|$))';

/** Compiled {@link BIOGRAPHY_URL_PATTERN_SOURCE} (case-insensitive). */
export const BIOGRAPHY_URL_PATTERN = new RegExp(BIOGRAPHY_URL_PATTERN_SOURCE, 'i');

/** FR-PROFILE-014 — true when the text contains an http(s) URL, a `www.`
 *  prefix, or a bare domain. Centralised so the UseCase and any future
 *  bio-bearing surface (onboarding, etc.) share one policy. The server-side
 *  CHECK constraint enforces the same shape on direct writes. */
export function containsBiographyUrl(text: string): boolean {
  return BIOGRAPHY_URL_PATTERN.test(text);
}
