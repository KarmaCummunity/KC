// The form's free `details` document ⇄ the baseline's detail columns.
//
// The create and edit forms keep one `details` object per listing (ride route and times, an
// event's window, a food offer's expiry ...). The baseline stores the same facts as typed columns
// of `post_ride_details`, `post_event_details` and `post_food_details`. This module converts in
// both directions; keys with no column stay in `posts.details`. Pure functions, no I/O.

import { readRideRoute, type RidePlace } from '@kc/domain';
import type { Json } from '../database.types';
import { refOfPlace, toPlaceDocument, type PlaceRef } from '../rides/ridePlaces';

type JsonObject = { [key: string]: Json | undefined };

/** The ride keys the route picker and schedule fields write; they never stay in `posts.details`. */
const RIDE_COLUMN_KEYS = new Set([
  'origin_place_kind', 'origin_place_id', 'origin_label', 'origin_lat', 'origin_lng', 'origin_city_id',
  'dest_place_kind', 'dest_place_id', 'dest_label', 'dest_lat', 'dest_lng', 'dest_city_id',
  'meeting_points', 'departs_at', 'arrives_at', 'seats_available', 'passengers', 'luggage',
  'reward_model', 'cost_share_ils',
]);
const EVENT_COLUMN_KEYS = new Set(['starts_at', 'ends_at', 'capacity', 'registration_policy', 'address', 'org_id']);
const FOOD_COLUMN_KEYS = new Set(['expires_at', 'allergens', 'kosher']);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;

/** The keys of `details` that no detail table owns: they stay in `posts.details`. */
export function freeDetails(details: Readonly<Record<string, unknown>>, world: 'rides' | 'event' | 'food' | 'plain'): JsonObject {
  const owned = { rides: RIDE_COLUMN_KEYS, event: EVENT_COLUMN_KEYS, food: FOOD_COLUMN_KEYS, plain: new Set<string>() }[world];
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(details)) {
    if (!owned.has(key) && value !== undefined && value !== null) out[key] = value as Json;
  }
  return out;
}

/** The route of a ride form: both ends as stored places, plus the meeting points. Null when an end is missing. */
export function rideRouteRefs(
  details: Readonly<Record<string, unknown>>,
): { origin: PlaceRef; dest: PlaceRef; meetingPoints: PlaceRef[] } | null {
  const route = readRideRoute({ ...details });
  const origin = route.origin ? refOfPlace(route.origin) : null;
  const dest = route.dest ? refOfPlace(route.dest) : null;
  if (!origin || !dest) return null;
  const meetingPoints = route.meetingPoints.flatMap((place) => {
    const ref = refOfPlace(place);
    return ref ? [ref] : [];
  });
  return { origin, dest, meetingPoints };
}

/** The city a ride post is filed under: the origin's, else the destination's (a junction has none). */
export function rideCityId(details: Readonly<Record<string, unknown>>): string | null {
  return text(details['origin_city_id']) ?? text(details['dest_city_id']) ?? null;
}

/** `post_ride_details` columns for the form's ride details (offer: seats offered; request: passengers). */
export function rideDetailColumns(details: Readonly<Record<string, unknown>>, direction: 'offer' | 'request'): JsonObject | null {
  const route = rideRouteRefs(details);
  if (!route) return null;
  const origin = toPlaceDocument(route.origin);
  const dest = toPlaceDocument(route.dest);
  const seats = integer(direction === 'offer' ? details['seats_available'] : details['passengers']) ?? 1;
  const reward = details['reward_model'] === 'expense_share' ? 'expense_share' : 'free';
  const out: JsonObject = {
    origin_city_id: origin.city_id, origin_street_id: origin.street_id, origin_junction_id: origin.junction_id,
    dest_city_id: dest.city_id, dest_street_id: dest.street_id, dest_junction_id: dest.junction_id,
    meeting_points: route.meetingPoints.map((ref) => ({ ...toPlaceDocument(ref) })),
    departs_at: text(details['departs_at']),
    arrives_at: text(details['arrives_at']),
    seats,
    luggage: details['luggage'] === true,
    reward_model: reward,
    cost_share_ils: reward === 'expense_share' && typeof details['cost_share_ils'] === 'number' ? details['cost_share_ils'] : null,
  };
  return out;
}

/** `post_event_details` columns for an event form's details. */
export function eventDetailColumns(details: Readonly<Record<string, unknown>>): JsonObject {
  const capacity = integer(details['capacity']);
  return {
    starts_at: text(details['starts_at']),
    ends_at: text(details['ends_at']),
    capacity: capacity ?? null,
    registration_policy: text(details['registration_policy']) ?? 'automatic',
    address_label: text(details['address']) ?? null,
  };
}

/** `post_food_details` columns for a food offer's details (`kosher` is yes / no in the form). */
export function foodDetailColumns(details: Readonly<Record<string, unknown>>): JsonObject {
  const allergens = Array.isArray(details['allergens']) ? details['allergens'].filter((a) => typeof a === 'string') : [];
  const kosher = details['kosher'];
  return {
    expires_at: text(details['expires_at']),
    allergens,
    kosher: kosher === 'yes' ? true : kosher === 'no' ? false : null,
  };
}

interface RideRowLike {
  readonly departs_at: string;
  readonly arrives_at: string | null;
  readonly seats: number;
  readonly luggage: boolean;
  readonly reward_model: string;
  readonly cost_share_ils: number | null;
}

/** The form-style ride details of a stored ride (the shape the ride screens read). */
export function rideDetailsFromRow(
  row: RideRowLike,
  direction: 'offer' | 'request',
  origin: RidePlace | null,
  dest: RidePlace | null,
  meetingPoints: readonly RidePlace[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    departs_at: row.departs_at,
    luggage: row.luggage,
    reward_model: row.reward_model,
    [direction === 'offer' ? 'seats_available' : 'passengers']: row.seats,
  };
  if (row.arrives_at) out['arrives_at'] = row.arrives_at;
  if (row.cost_share_ils !== null) out['cost_share_ils'] = row.cost_share_ils;
  for (const [end, place] of [['origin', origin], ['dest', dest]] as const) {
    if (!place) continue;
    out[`${end}_place_kind`] = place.kind;
    out[`${end}_place_id`] = place.id;
    out[`${end}_label`] = place.label;
    out[`${end}_lat`] = place.lat;
    out[`${end}_lng`] = place.lng;
    if (place.cityId) out[`${end}_city_id`] = place.cityId;
  }
  if (meetingPoints.length > 0) {
    out['meeting_points'] = meetingPoints.map((p) => ({ kind: p.kind, id: p.id, label: p.label, lat: p.lat, lng: p.lng, city_id: p.cityId }));
  }
  return out;
}
