// A listing's detail page: `post_detail` (card, gallery, first comments) plus the world's detail row.
//
// The detail screens read one legacy-shaped `details` document (a ride's route and seats, an
// event's window, a food offer's expiry), so the world's detail table is read next to the payload
// and folded into it by `worldDetails.ts`. Everything the viewer may not see is simply absent: the
// RPC and the tables run with the caller's rights.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rideWeekdaysToMask, toVerificationLevel, type MarketplaceListingDetail } from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { parseWkbPoint } from '../posts/postMapPoint';
import type { PostCardRow } from '../posts/mapPostRow';
import { meetingPointRefs, placeRefKey, resolvePlaces, type PlaceRef } from '../rides/ridePlaces';
import { listingDirectionOf, loadKindCatalog } from './kindCatalog';
import { availabilityOf, listingStatusOf } from './listingMapping';
import { israelTimeOfDay, rideDetailsFromRow } from './worldDetails';

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
  const places = await resolvePlaces(client, [origin, dest, ...stops]);
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
  if (row.series_id && row.series_on) {
    const marker = await seriesMarker(client, row.series_id, row.series_on, row.departs_at);
    if (marker) details['ride_series'] = marker;
  }
  return details;
}

/**
 * The marker of a recurring ride's occurrence. A series row is its owner's alone, so the weekdays
 * are read off the occurrences themselves: the scheduler keeps every running day of the next 30
 * days published, so the distinct weekdays of their dates are the series' weekdays.
 */
async function seriesMarker(client: Client, seriesId: string, on: string, departsAt: string): Promise<Record<string, unknown> | null> {
  const rows = unwrapCall(
    'table:post_ride_details',
    await client.from('post_ride_details').select('series_on').eq('series_id', seriesId),
  );
  const days = (rows ?? []).flatMap((r) => (r.series_on ? [new Date(`${r.series_on}T00:00:00Z`).getUTCDay()] : []));
  const mask = rideWeekdaysToMask(days);
  return mask === 0 ? null : { id: seriesId, on, weekdays: mask, time: israelTimeOfDay(departsAt) };
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
    listingStatus: listingStatusOf(card.status),
    publishedAt: card.published_at,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    maxRadiusKm: null,
    media: mediaRows.flatMap((m, index) =>
      isObject(m) && typeof m['storage_key'] === 'string' ? [{ storagePath: m['storage_key'], sortOrder: index }] : [],
    ),
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
