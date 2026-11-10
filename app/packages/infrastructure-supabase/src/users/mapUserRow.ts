// Row → domain User mapper. Shared by findById / findByHandle.
// The shape mirrors the columns from `users` (see 0001_init_users.sql).
import { toVerificationLevel, type PrivacyMode, type User } from '@kc/domain';

// TD-69 (audit 2026-05-16, P2.12) — narrow the raw DB string into the
// 2-value domain union. Before D-21 (2026-05-15) the column could legally
// be `'Followers'`; after D-21 only `'Public'` / `'Private'` are valid.
// Any drift (legacy row, mid-migration state, or a future column-type
// change) must collapse to `'Public'` rather than silently flow into FE
// predicates like `MyProfileChrome.tsx` follow-requests link and the lock
// icon, where an out-of-union value would misfire.
function asPrivacyMode(raw: string | null | undefined): PrivacyMode {
  return raw === 'Private' ? 'Private' : 'Public';
}

export interface UserRow {
  user_id: string;
  auth_provider: string;
  share_handle: string;
  display_name: string | null;
  city: string | null;
  city_name: string | null;
  profile_street?: string | null;
  profile_street_number?: string | null;
  contact_phone?: string | null;
  biography: string | null;
  avatar_url: string | null;
  privacy_mode: string;
  privacy_changed_at: string | null;
  account_status: string;
  onboarding_state: string;
  notification_preferences: unknown;
  is_super_admin: boolean;
  closure_explainer_dismissed: boolean;
  first_post_nudge_dismissed: boolean;
  items_given_count: number;
  items_received_count: number;
  active_posts_count_internal: number;
  followers_count: number;
  following_count: number;
  karma_points: number;
  verification_level?: number | null;
  created_at: string;
  updated_at: string;
  preferred_language?: string | null;
}

export function mapUserRow(row: UserRow): User {
  return {
    userId: row.user_id,
    authProvider: row.auth_provider as User['authProvider'],
    shareHandle: row.share_handle,
    displayName: row.display_name,
    city: row.city,
    cityName: row.city_name,
    profileStreet: row.profile_street ?? null,
    profileStreetNumber: row.profile_street_number ?? null,
    contactPhone: row.contact_phone ?? null,
    // Private: only users_get_self_private_fields() carries it, never the users row.
    dateOfBirth: null,
    biography: row.biography,
    avatarUrl: row.avatar_url,
    privacyMode: asPrivacyMode(row.privacy_mode),
    privacyChangedAt: row.privacy_changed_at,
    accountStatus: row.account_status as User['accountStatus'],
    onboardingState: row.onboarding_state as User['onboardingState'],
    notificationPreferences: row.notification_preferences as User['notificationPreferences'],
    isSuperAdmin: row.is_super_admin,
    closureExplainerDismissed: row.closure_explainer_dismissed,
    firstPostNudgeDismissed: row.first_post_nudge_dismissed,
    itemsGivenCount: row.items_given_count,
    itemsReceivedCount: row.items_received_count,
    activePostsCountInternal: row.active_posts_count_internal,
    followersCount: row.followers_count,
    followingCount: row.following_count,
    karmaPoints: row.karma_points,
    verificationLevel: toVerificationLevel(row.verification_level),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preferredLanguage: row.preferred_language ?? null,
  };
}
