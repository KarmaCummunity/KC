// Rows of the identity tables → the domain `User`.
//
// The baseline splits a member over four tables (docs/db/target-design.md §9):
//   `users`         the public profile, readable for every active member;
//   `user_stats`    the counters, readable for every member whose profile is visible;
//   `user_private`  contact phone, date of birth, address, preferences — the member's own row only;
//   `user_account`  status and onboarding — the member's own row only.
// The owner's two private tables arrive through `bootstrap_session()` (see `ownerSlice`); for
// another member those fields get the neutral values documented on `toUser`.
// Shared by the reads of this folder (profile, search, follower lists, realtime).

import {
  toVerificationLevel,
  type AccountStatus,
  type NotificationPreferences,
  type OnboardingState,
  type PrivacyMode,
  type User,
} from '@kc/domain';
import type { BootstrapAccount, BootstrapPrivateProfile } from '../auth/bootstrapSession';

// TD-69 — narrow the raw DB string into the 2-value domain union. Any drift collapses to
// 'Public' rather than flowing into front-end predicates (lock icon, follow-requests link).
function asPrivacyMode(raw: string | null | undefined): PrivacyMode {
  return raw === 'Private' ? 'Private' : 'Public';
}

/** Columns of `public.users` the app reads (all of them are granted to `authenticated`). */
export const USER_COLUMNS =
  'id, share_handle, display_name, biography, avatar_url, city_id, privacy_mode, privacy_changed_at, verification_level, preferred_language, created_at, updated_at' as const;

/** Columns of `public.user_stats` granted to `authenticated` (`open_posts_only_me` is not). */
export const USER_STATS_COLUMNS =
  'user_id, followers_count, following_count, items_given_count, items_received_count, open_posts_public, open_posts_followers_only' as const;

/** A row of `public.users` selected with {@link USER_COLUMNS}. */
export interface UserRow {
  id: string;
  share_handle: string;
  display_name: string | null;
  biography: string | null;
  avatar_url: string | null;
  city_id: string | null;
  privacy_mode: string;
  privacy_changed_at: string | null;
  verification_level: number | null;
  preferred_language: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of `public.user_stats` selected with {@link USER_STATS_COLUMNS}. */
export interface UserStatsRow {
  user_id: string;
  followers_count: number;
  following_count: number;
  items_given_count: number;
  items_received_count: number;
  open_posts_public: number;
  open_posts_followers_only: number;
}

/** The signed-in member's own private state, from `bootstrap_session()`. */
export interface OwnerSlice {
  readonly account: BootstrapAccount;
  readonly privateProfile: BootstrapPrivateProfile;
  readonly adminRoles: readonly string[];
  /** The caller's karma total: private to its owner, read through `my_karma_points()`. */
  readonly karmaPoints: number;
}

/** What a user needs besides the `users` row. */
export interface UserExtras {
  /** `cities.name_he` of `users.city_id`; null when no city is set. */
  readonly cityName: string | null;
  readonly stats: UserStatsRow | null;
  /** Present only when the row is the caller's own. */
  readonly owner: OwnerSlice | null;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = { critical: true, social: true };

/**
 * The stored `notification_preferences` object with its defaults: the column starts as `{}`,
 * and `critical` / `social` are on unless the member turned them off.
 */
export function toNotificationPreferences(stored: Readonly<Record<string, unknown>>): NotificationPreferences {
  const { quietHours, kinds } = stored;
  return {
    critical: stored['critical'] !== false,
    social: stored['social'] !== false,
    ...(quietHours && typeof quietHours === 'object'
      ? { quietHours: quietHours as NotificationPreferences['quietHours'] }
      : {}),
    ...(kinds && typeof kinds === 'object' ? { kinds: kinds as NotificationPreferences['kinds'] } : {}),
  };
}

/**
 * Domain user from a `users` row. Fields only the owner can read are neutral for anyone else:
 * no contact phone, date of birth or address, default notification preferences, no staff role and
 * `activePostsCountInternal` 0 (TD-39: a counter delta must not reveal OnlyMe posts). A member
 * another member can read is always `active` (the visibility policy hides the rest), and their
 * onboarding state is not readable, so it is the neutral `completed`.
 */
export function mapUserRow(row: UserRow, extras: UserExtras): User {
  const { owner, stats } = extras;
  const profile = owner?.privateProfile;
  return {
    userId: row.id,
    shareHandle: row.share_handle,
    displayName: row.display_name,
    city: row.city_id,
    cityName: extras.cityName,
    profileStreet: profile?.profileStreet ?? null,
    profileStreetNumber: profile?.profileStreetNumber ?? null,
    contactPhone: profile?.contactPhone ?? null,
    dateOfBirth: profile?.dateOfBirth ?? null,
    biography: row.biography,
    avatarUrl: row.avatar_url,
    privacyMode: asPrivacyMode(row.privacy_mode),
    privacyChangedAt: row.privacy_changed_at,
    accountStatus: (owner?.account.status ?? 'active') as AccountStatus,
    onboardingState: (owner?.account.onboardingState ?? 'completed') as OnboardingState,
    notificationPreferences: profile
      ? toNotificationPreferences(profile.notificationPreferences)
      : { ...DEFAULT_NOTIFICATION_PREFS },
    isSuperAdmin: owner?.adminRoles.includes('super_admin') ?? false,
    closureExplainerDismissed: profile?.closureExplainerDismissed ?? false,
    firstPostNudgeDismissed: profile?.firstPostNudgeDismissed ?? false,
    itemsGivenCount: stats?.items_given_count ?? 0,
    itemsReceivedCount: stats?.items_received_count ?? 0,
    // The owner's open posts that are not OnlyMe (that counter is not client-readable).
    activePostsCountInternal: owner && stats ? stats.open_posts_public + stats.open_posts_followers_only : 0,
    followersCount: stats?.followers_count ?? 0,
    followingCount: stats?.following_count ?? 0,
    // Karma is private to its owner: another member's total is not readable, so it shows as 0.
    karmaPoints: owner?.karmaPoints ?? 0,
    verificationLevel: toVerificationLevel(row.verification_level),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preferredLanguage: row.preferred_language,
  };
}
