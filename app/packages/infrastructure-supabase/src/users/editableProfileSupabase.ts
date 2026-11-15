import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { updateUserPrivate, type UserPrivatePatch } from './ownPrivateUpdate';
import { updateOwnUser, type UserProfilePatch } from './ownUserUpdate';
import { sessionUserId } from './userReads';

export type EditableProfileDTO = {
  displayName: string | null;
  city: string | null;
  cityName: string | null;
  profileStreet: string | null;
  profileStreetNumber: string | null;
  contactPhone: string | null;
  biography: string | null;
  avatarUrl: string | null;
};

/** The own-row private fields of the edit form (RLS: only the caller's row is readable). */
async function readOwnPrivateFields(client: SupabaseClient<Database>, userId: string) {
  const row = unwrapCall(
    'table:user_private',
    await client
      .from('user_private')
      .select('contact_phone, profile_street, profile_street_number')
      .eq('user_id', userId)
      .maybeSingle(),
  );
  return {
    contactPhone: row?.contact_phone ?? null,
    profileStreet: row?.profile_street ?? null,
    profileStreetNumber: row?.profile_street_number ?? null,
  };
}

async function readCityName(client: SupabaseClient<Database>, cityId: string | null): Promise<string | null> {
  if (!cityId) return null;
  const row = unwrapCall(
    'table:cities',
    await client.from('cities').select('name_he').eq('city_id', cityId).maybeSingle(),
  );
  return row?.name_he ?? null;
}

export async function supabaseGetEditableProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<EditableProfileDTO> {
  const row = unwrapCall(
    'table:users',
    await client.from('users').select('display_name, city_id, biography, avatar_url').eq('id', userId).maybeSingle(),
  );
  if (!row) throw new Error('getEditableProfile: no row');
  // The phone and address are the caller's own `user_private` row: read them only when the
  // caller owns the profile. For another member they stay null. `auth.getSession()` reads the
  // cached JWT — no network round-trip.
  const isOwner = (await sessionUserId(client)) === userId;
  const [cityName, privateFields] = await Promise.all([
    readCityName(client, row.city_id),
    isOwner
      ? readOwnPrivateFields(client, userId)
      : { contactPhone: null, profileStreet: null, profileStreetNumber: null },
  ]);
  return {
    displayName: row.display_name,
    city: row.city_id,
    cityName,
    ...privateFields,
    biography: row.biography,
    avatarUrl: row.avatar_url,
  };
}

export function supabaseSetProfileAddressLines(
  client: SupabaseClient<Database>,
  userId: string,
  street: string | null,
  streetNumber: string | null,
): Promise<void> {
  return updateUserPrivate(client, userId, { profile_street: street, profile_street_number: streetNumber });
}

export type EditableProfilePatch = {
  displayName?: string;
  city?: string;
  profileStreet?: string | null;
  profileStreetNumber?: string | null;
  contactPhone?: string | null;
  biography?: string | null;
  avatarUrl?: string | null;
};

/** The `users` columns of a profile edit (undefined fields are left out, null clears). */
function toProfileColumns(patch: EditableProfilePatch): UserProfilePatch {
  const columns: UserProfilePatch = {};
  if (patch.displayName !== undefined) columns.display_name = patch.displayName;
  if (patch.city !== undefined) columns.city_id = patch.city;
  if (patch.biography !== undefined) columns.biography = patch.biography;
  if (patch.avatarUrl !== undefined) columns.avatar_url = patch.avatarUrl;
  return columns;
}

/** The `user_private` columns of a profile edit. */
function toPrivateColumns(patch: EditableProfilePatch): UserPrivatePatch {
  const columns: UserPrivatePatch = {};
  if (patch.profileStreet !== undefined) columns.profile_street = patch.profileStreet;
  if (patch.profileStreetNumber !== undefined) columns.profile_street_number = patch.profileStreetNumber;
  if (patch.contactPhone !== undefined) columns.contact_phone = patch.contactPhone;
  return columns;
}

/**
 * Audit §3.5 — a multi-field edit. The profile now lives in two tables, so it is two
 * statements (public columns first, then the private ones): each is atomic, the pair is not.
 * Caller passes only the fields it wants to change.
 */
export async function supabaseUpdateEditableProfile(
  client: SupabaseClient<Database>,
  userId: string,
  patch: EditableProfilePatch,
): Promise<void> {
  const profile = toProfileColumns(patch);
  const personal = toPrivateColumns(patch);
  if (Object.keys(profile).length > 0) await updateOwnUser(client, userId, profile);
  if (Object.keys(personal).length > 0) await updateUserPrivate(client, userId, personal);
}

export function supabaseSetContactPhone(
  client: SupabaseClient<Database>,
  userId: string,
  contactPhone: string | null,
): Promise<void> {
  return updateUserPrivate(client, userId, { contact_phone: contactPhone });
}
