import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@kc/domain';

export interface UsersSelfPrivateSlice {
  contact_phone: string | null;
  profile_street: string | null;
  profile_street_number: string | null;
  notification_preferences: unknown;
  is_super_admin: boolean;
  active_posts_count_internal: number;
  /** FR-KARMA-007 — self-only; added to RPC in migration 0191. */
  karma_points: number;
  /** FR-AUTH-010 AC2.d — ISO `YYYY-MM-DD`; added to the RPC in migration 0590. */
  date_of_birth: string | null;
}

/** Owner-only fields from users_get_self_private_fields() (migration 0163). */
export async function fetchUsersSelfPrivateFields(
  client: SupabaseClient,
): Promise<UsersSelfPrivateSlice | null> {
  const { data, error } = await client.rpc('users_get_self_private_fields');
  if (error) throw new Error(`users_get_self_private_fields: ${error.message}`);
  if (data == null) return null;
  return data as UsersSelfPrivateSlice;
}

export function mergeSelfPrivateFields(user: User, slice: UsersSelfPrivateSlice): User {
  return {
    ...user,
    contactPhone: slice.contact_phone ?? null,
    profileStreet: slice.profile_street ?? null,
    profileStreetNumber: slice.profile_street_number ?? null,
    notificationPreferences: slice.notification_preferences as User['notificationPreferences'],
    isSuperAdmin: slice.is_super_admin,
    activePostsCountInternal: slice.active_posts_count_internal,
    karmaPoints: slice.karma_points ?? 0,
    dateOfBirth: slice.date_of_birth ?? null,
  };
}
