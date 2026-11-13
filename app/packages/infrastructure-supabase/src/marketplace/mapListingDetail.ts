// A listing's detail page: `post_detail` (card, gallery, first comments) plus the world's detail row.
//
// The detail screens read one legacy-shaped `details` document (a ride's route and seats, an
// event's window, a food offer's expiry), so the world's detail table is read next to the payload
// and folded into it by `worldDetails.ts`. Everything the viewer may not see is simply absent: the
// RPC and the tables run with the caller's rights.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toVerificationLevel, type MarketplaceListingDetail } from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { parseWkbPoint } from '../posts/postMapPoint';
import type { PostCardRow } from '../posts/mapPostRow';
import { meetingPointRefs, placeRefKey, resolvePlaces, type PlaceRef } from '../rides/ridePlaces';
import { listingDirectionOf, loadKindCatalog } from './kindCatalog';
import { availabilityOf } from './listingMapping';
import { rideDetailsFromRow } from './worldDetails';

type Client = SupabaseClient<Database>;
type JsonObject = { [key: string]: Json | undefined };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The world's own details, in the shape the detail screens read. */
async function loadWorldDetails(client: Client, card: PostCardRow): Promise<Record<string, unknown>> {
  const postId = card.id as string;
  const base: Record<string, unknown> = isObject(card.details) ? { ...card.details } : {};
  if (card.post_type === 'ride') return { ...base, ...(await loadRideDetails(client, postId, card)) };
  if (card.post_type === 'event') return { ...base, ...(await loadEventDetails(client, postId)) };
  if (card.world_slug === 'food' && card.direction === 'offer') return { ...base, ...(await loadFoodDetails(client, postId)) };
  return base;
}

async function loadRideDetails(client: Client, postId: string, card: PostCardRow): Promise<Record<string, unknown>> {
  const row = unwrapCall(
    'table:post_ride_details',
    await client.from('post_ride_details').select('*').eq('post_id', postId).maybeSingle(),
  );
  if (!row) return {};
  const origin: PlaceRef = { cityId: row.origin_city_id, streetId: row.origin_street_id, junctionId: row.origin_junction_id };
  const dest: PlaceRef = { cityId: row.dest_city_id, streetId: row.dest_street_id, junctionId: row.dest_junction_id };
  const stops = meetingPointRefs(row.meeting_points);
  // The place names and the series marker depend only on the ride row, so they share one round
  // trip instead of two in sequence.
  const [places, marker] = await Promise.all([
    resolvePlaces(client, [origin, dest, ...stops]),
    row.series_id ? seriesMarker(client, postId) : null,
  ]);
  const details = rideDetailsFromRow(
    row,
    card.direction === 'request' ? 'request' : 'offer',
    places.get(placeRefKey(origin)) ?? null,
    places.get(placeRefKey(dest)) ?? null,
    stops.flatMap((ref) => {
      const place = places.get(placeRefKey(ref));
      return place ? [place] : [];
    }),
  );
  if (marker) details['ride_series'] = marker;
  return details;
}

/**
 * The marker of a recurring ride's occurrence, from its series' schedule
 * (`ride_occurrence_schedules`); null once the series was cancelled. `depart_time` arrives as
 * `HH:MM:SS`, Israel time; `weekdays` is the series' bit set (bit 0 = Sunday).
 */
async function seriesMarker(client: Client, postId: string): Promise<Record<string, unknown> | null> {
  const rows = unwrapCall('rpc:ride_occurrence_schedules', await client.rpc('ride_occurrence_schedules', { p_post_ids: [postId] }));
  const schedule = rows?.[0];
  if (!schedule) return null;
  return { id: schedule.series_id, on: schedule.series_on, weekdays: schedule.weekdays, time: schedule.depart_time.slice(0, 5) };
}

async function loadEventDetails(client: Client, postId: string): Promise<Record<string, unknown>> {
  const [event, post] = await Promise.all([
    client.from('post_event_details').select('*').eq('post_id', postId).maybeSingle(),
    client.from('posts').select('beneficiary_org_id').eq('id', postId).maybeSingle(),
  ]);
  const row = unwrapCall('table:post_event_details', event);
  if (!row) return {};
  const orgId = unwrapCall('table:posts', post)?.beneficiary_org_id;
  return {
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    capacity: row.capacity,
    registration_policy: row.registration_policy,
    address: row.address_label,
    ...(orgId ? { org_id: orgId } : {}),
    // A date of a recurring event names its series and day (FR-POST-024).
    ...(row.series_id ? { series_id: row.series_id, series_on: row.series_on } : {}),
  };
}

async function loadFoodDetails(client: Client, postId: string): Promise<Record<string, unknown>> {
  const row = unwrapCall(
    'table:post_food_details',
    await client.from('post_food_details').select('expires_at, allergens, kosher').eq('post_id', postId).maybeSingle(),
  );
  if (!row) return {};
  const kosher = row.kosher === null ? {} : { kosher: row.kosher ? 'yes' : 'no' };
  return { expires_at: row.expires_at, allergens: row.allergens, ...kosher };
}

/** The detail of a listing, or null when the caller cannot read the post. */
export async function fetchListingDetail(client: Client, listingId: string): Promise<MarketplaceListingDetail | null> {
  const payload = unwrapCall('rpc:post_detail', await client.rpc('post_detail', { p_post_id: listingId }));
  if (!isObject(payload) || !isObject(payload['post'])) return null;
  const card = payload['post'] as unknown as PostCardRow;
  if (!card.id) return null;
  const mediaRows = Array.isArray(payload['media']) ? payload['media'] : [];
  const [kinds, world, geo, details] = await Promise.all([
    loadKindCatalog(client),
    client.from('worlds').select('label_he, label_en').eq('slug', card.world_slug ?? '').maybeSingle(),
    client.from('posts').select('geo_approx').eq('id', card.id).maybeSingle(),
    loadWorldDetails(client, card),
  ]);
  const kind = card.kind_id ? kinds.byId.get(card.kind_id) : undefined;
  const worldRow = unwrapCall('table:worlds', world);
  const point = parseWkbPoint(unwrapCall('table:posts', geo)?.geo_approx);
  return {
    listingId: card.id,
    ownerId: card.owner_id ?? '',
    worldSlug: card.world_slug ?? '',
    worldLabelEn: worldRow?.label_en ?? '',
    worldLabelHe: worldRow?.label_he ?? '',
    kindSlug: kind?.slug ?? '',
    kindLabelEn: kind?.label_en ?? '',
    kindLabelHe: kind?.label_he ?? '',
    direction: listingDirectionOf(card.direction),
    title: card.title ?? '',
    summary: card.description,
    details,
    cityId: card.city_id,
    urgencyLevel: card.urgency_level ?? 2,
    availabilityStatus: availabilityOf(card.status),
    listingStatus: card.status ?? 'open',
    publishedAt: card.published_at,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    maxRadiusKm: null,
    media: mediaRows.flatMap((m, index) => {
      if (!isObject(m) || typeof m['storage_key'] !== 'string') return [];
      const mimeType = typeof m['mime_type'] === 'string' ? m['mime_type'] : 'image/jpeg';
      const sizeBytes = typeof m['size_bytes'] === 'number' ? m['size_bytes'] : 0;
      return [{ storagePath: m['storage_key'], sortOrder: index, mimeType, sizeBytes }];
    }),
    owner: card.owner_id
      ? {
          userId: card.owner_id,
          displayName: card.owner_display_name,
          avatarUrl: card.owner_avatar_url,
          shareHandle: card.owner_share_handle,
          cityId: null,
          verificationLevel: toVerificationLevel(card.owner_verification_level),
        }
      : null,
    feedPostId: card.id,
    feedHidden: false,
  };
}
