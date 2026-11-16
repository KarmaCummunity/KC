// A listing owner's actions (spec 07 §7.1 "Owner management"): pause, resume, close, delete, edit
// and add photos. The status moves are RPCs that enforce the lifecycle (`listing_wrong_status`,
// `listing_has_active_handoff`, ...); an edit is a direct update of the post and of its detail
// row, which row-level security allows while the post is a draft, open or paused.

import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendRuleError } from '@kc/domain';
import type { IMarketplaceRepository, MediaAssetInput } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { recordPhotos } from './listingWrites';
import { eventDetailColumns, foodDetailColumns, freeDetails, rideCityId, rideDetailColumns } from './worldDetails';

type Client = SupabaseClient<Database>;
type UpdatePatch = Parameters<IMarketplaceRepository['updateMyListing']>[1];

/** The owner actions that take only the listing id. */
export type OwnerAction = 'pause' | 'resume' | 'fulfill' | 'delete';

/** Photos a post holds at most. */
const MAX_PHOTOS = 5;

/** Runs one status move of the owner's post; a refusal keeps its stable reason. */
export async function runOwnerAction(client: Client, action: OwnerAction, listingId: string): Promise<void> {
  const args = { p_post_id: listingId };
  switch (action) {
    case 'pause':
      unwrapCall('rpc:pause_post', await client.rpc('pause_post', args));
      return;
    case 'resume':
      unwrapCall('rpc:resume_post', await client.rpc('resume_post', args));
      return;
    case 'fulfill':
      unwrapCall('rpc:close_post_without_recipient', await client.rpc('close_post_without_recipient', args));
      return;
    case 'delete':
      unwrapCall('rpc:delete_post', await client.rpc('delete_post', args));
  }
}

/** The part of the post an edit has to know: which detail table it has. */
async function loadShape(client: Client, listingId: string) {
  const row = unwrapCall(
    'table:posts',
    await client.from('posts').select('post_type, world_slug, direction, details').eq('id', listingId).maybeSingle(),
  );
  if (!row) throw new BackendRuleError('post_not_found', 'table:posts');
  return row;
}

/** Which world's detail shape a listing's free details follow. */
function detailsWorldOf(shape: Awaited<ReturnType<typeof loadShape>>): 'rides' | 'event' | 'food' | 'plain' {
  if (shape.post_type === 'ride') return 'rides';
  if (shape.post_type === 'event') return 'event';
  return shape.world_slug === 'food' && shape.direction === 'offer' ? 'food' : 'plain';
}

/** Updates one detail table; an empty answer means the row is not editable by the caller. */
async function updateDetailRow(client: Client, table: 'post_ride_details' | 'post_event_details' | 'post_food_details', listingId: string, columns: object): Promise<void> {
  const rows = unwrapCall(`table:${table}`, await client.from(table).update(columns as never).eq('post_id', listingId).select('post_id'));
  if (!rows || rows.length === 0) throw new BackendRuleError('listing_wrong_status', `table:${table}`);
}

/** Field edit of a draft, open or paused listing; a closed listing's fields are locked server-side. */
export async function updateMyListing(client: Client, listingId: string, patch: UpdatePatch): Promise<void> {
  const shape = await loadShape(client, listingId);
  const form = patch.details ?? {};
  const world = detailsWorldOf(shape);
  const post: Database['public']['Tables']['posts']['Update'] = {};
  if (patch.title !== undefined) post.title = patch.title;
  if (patch.summary !== undefined) post.description = patch.summary;
  if (patch.urgencyLevel !== undefined) post.urgency_level = patch.urgencyLevel;
  const cityId = world === 'rides' ? rideCityId(form) : patch.cityId;
  if (cityId) post.city_id = cityId;
  if (patch.details !== undefined) post.details = freeDetails(form, world) as Json;
  if (Object.keys(post).length > 0) {
    const rows = unwrapCall('table:posts', await client.from('posts').update(post).eq('id', listingId).select('id'));
    if (!rows || rows.length === 0) throw new BackendRuleError('listing_wrong_status', 'table:posts');
  }
  if (patch.details === undefined) return;
  if (world === 'rides') {
    const columns = rideDetailColumns(form, shape.direction === 'request' ? 'request' : 'offer');
    if (columns) await updateDetailRow(client, 'post_ride_details', listingId, columns);
  } else if (world === 'event') {
    await updateDetailRow(client, 'post_event_details', listingId, eventDetailColumns(form));
  } else if (world === 'food') {
    await updateDetailRow(client, 'post_food_details', listingId, foodDetailColumns(form));
  }
}

/** Appends uploaded photos to the owner's listing; resolves with how many were added (duplicates are skipped, five at most). */
export async function addMyListingMedia(client: Client, listingId: string, media: readonly MediaAssetInput[]): Promise<number> {
  const ownerId = await sessionUserId(client);
  if (!ownerId) throw new BackendRuleError('unauthenticated', 'table:post_media');
  const existing = unwrapCall('table:post_media', await client.from('post_media').select('storage_key, ordinal').eq('post_id', listingId)) ?? [];
  const known = new Set(existing.map((row) => row.storage_key));
  const fresh = media.filter((asset) => !known.has(asset.path));
  const next = existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.ordinal)) + 1;
  return next >= MAX_PHOTOS ? 0 : recordPhotos(client, listingId, ownerId, fresh, next);
}
