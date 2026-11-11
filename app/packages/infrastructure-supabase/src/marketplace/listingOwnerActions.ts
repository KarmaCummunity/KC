import type { SupabaseClient } from '@supabase/supabase-js';
import type { IMarketplaceRepository } from '@kc/application';
import type { Database } from '../database.legacy.types';

// A listing owner's actions (spec 07 §7.1 "Owner management", migration 0543), split out of
// SupabaseMarketplaceRepository to keep that file under the 300-line architecture cap. Each
// RPC enforces the status rules server-side and raises a code the client maps to a message
// (listing_wrong_status, listing_has_active_handoff, ...); the PostgrestError is rethrown as is.
type Client = SupabaseClient<Database>;
type UpdatePatch = Parameters<IMarketplaceRepository['updateMyListing']>[1];

/** The owner RPCs that take only the listing id. */
export type OwnerActionRpc = 'pause_my_listing' | 'resume_my_listing' | 'fulfill_my_listing' | 'delete_my_listing';

export async function runOwnerAction(client: Client, rpc: OwnerActionRpc, listingId: string): Promise<void> {
  const { error } = await client.rpc(rpc, { p_listing_id: listingId });
  if (error) throw error;
}

/** Field edit of an open or paused listing; a closed listing's fields are locked server-side. */
export async function updateMyListing(client: Client, listingId: string, patch: UpdatePatch): Promise<void> {
  const { error } = await client.rpc('update_my_listing', {
    p_listing_id: listingId,
    p_title: patch.title,
    p_summary: patch.summary ?? undefined,
    p_details: (patch.details ?? undefined) as Database['public']['Functions']['update_my_listing']['Args']['p_details'],
    p_city_id: patch.cityId ?? undefined,
    p_max_radius_km: patch.maxRadiusKm ?? undefined,
    p_urgency_level: patch.urgencyLevel,
    p_availability_status: patch.availabilityStatus,
  });
  if (error) throw error;
}

/** Appends uploaded photos; resolves with how many were added (duplicates are skipped). */
export async function addMyListingMedia(
  client: Client,
  listingId: string,
  mediaPaths: readonly string[],
): Promise<number> {
  const { data, error } = await client.rpc('add_my_listing_media', {
    p_listing_id: listingId,
    p_storage_paths: [...mediaPaths],
  });
  if (error) throw error;
  return data ?? 0;
}
