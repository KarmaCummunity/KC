import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchUsersSelfPrivateFields } from './usersSelfPrivateFields';

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

export async function supabaseGetEditableProfile(
  client: SupabaseClient,
  userId: string,
): Promise<EditableProfileDTO> {
  const { data, error } = await client
    .from('users')
    .select('display_name, city, city_name, biography, avatar_url')
    .eq('user_id', userId)
    .single();
  if (error) throw new Error(`getEditableProfile: ${error.message}`);
  if (!data) throw new Error('getEditableProfile: no row');
  const row = data as {
    display_name: string | null;
    city: string | null;
    city_name: string | null;
    biography: string | null;
    avatar_url: string | null;
  };
  // users_get_self_private_fields() returns the *caller's* phone and address, not
  // those of `userId`, so they are merged only when the caller owns the row (the
  // owner check fetchUserBy makes). For another member the private fields stay null.
  // `auth.getSession()` reads the cached JWT — no network round-trip.
  const { data: sessionData } = await client.auth.getSession();
  const isOwner = sessionData.session?.user.id === userId;
  const slice = isOwner ? await fetchUsersSelfPrivateFields(client) : null;
  return {
    displayName: row.display_name,
    city: row.city,
    cityName: row.city_name,
    profileStreet: slice?.profile_street ?? null,
    profileStreetNumber: slice?.profile_street_number ?? null,
    contactPhone: slice?.contact_phone ?? null,
    biography: row.biography,
    avatarUrl: row.avatar_url,
  };
}

export async function supabaseSetProfileAddressLines(
  client: SupabaseClient,
  userId: string,
  street: string | null,
  streetNumber: string | null,
): Promise<void> {
  const { error } = await client
    .from('users')
    .update({ profile_street: street, profile_street_number: streetNumber })
    .eq('user_id', userId);
  if (error) throw new Error(`setProfileAddressLines: ${error.message}`);
}

export type EditableProfilePatch = {
  displayName?: string;
  city?: string;
  cityName?: string;
  profileStreet?: string | null;
  profileStreetNumber?: string | null;
  contactPhone?: string | null;
  biography?: string | null;
  avatarUrl?: string | null;
};

/** Audit §3.5 — single `UPDATE users SET ...` so a multi-column edit lands
 *  atomically. Caller passes only the fields it wants to change. */
export async function supabaseUpdateEditableProfile(
  client: SupabaseClient,
  userId: string,
  patch: EditableProfilePatch,
): Promise<void> {
  const row: Record<string, string | null> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.cityName !== undefined) row.city_name = patch.cityName;
  if (patch.profileStreet !== undefined) row.profile_street = patch.profileStreet;
  if (patch.profileStreetNumber !== undefined) row.profile_street_number = patch.profileStreetNumber;
  if (patch.contactPhone !== undefined) row.contact_phone = patch.contactPhone;
  if (patch.biography !== undefined) row.biography = patch.biography;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (Object.keys(row).length === 0) return; // empty patch — caller is expected to validate
  const { error } = await client.from('users').update(row).eq('user_id', userId);
  if (error) throw new Error(`updateEditableProfile: ${error.message}`);
}

export async function supabaseSetContactPhone(
  client: SupabaseClient,
  userId: string,
  contactPhone: string | null,
): Promise<void> {
  const { error } = await client
    .from('users')
    .update({ contact_phone: contactPhone })
    .eq('user_id', userId);
  if (error) throw new Error(`setContactPhone: ${error.message}`);
}
