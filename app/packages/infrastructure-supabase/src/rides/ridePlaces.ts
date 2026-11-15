// Official ride places (D71): a city, a street of a city, or a road junction.
//
// The app names a place by `kind` + `id` (a street's id is `<cityId>:<streetId>`); the baseline
// stores three nullable columns (`*_city_id`, `*_street_id`, `*_junction_id`). This module converts
// between the two and resolves stored places back to a label and a point, one query per catalog for
// a whole page of rides.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RidePlace } from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { parseWkbPoint } from '../posts/postMapPoint';

type Client = SupabaseClient<Database>;

/** A place as the baseline stores it: exactly one of a junction or a city (with an optional street). */
export interface PlaceRef {
  readonly cityId: string | null;
  readonly streetId: number | null;
  readonly junctionId: number | null;
}

/** The `{city_id, street_id, junction_id}` document `rides_feed` filters and the ride payloads use. */
export interface PlaceDocument {
  readonly city_id: string | null;
  readonly street_id: number | null;
  readonly junction_id: number | null;
}

/** The place an app `RidePlace` (kind + id) stands for; null when the id cannot be read. */
export function refOfPlace(place: Pick<RidePlace, 'kind' | 'id'>): PlaceRef | null {
  if (place.kind === 'city') return { cityId: place.id, streetId: null, junctionId: null };
  if (place.kind === 'junction') {
    const junctionId = Number(place.id);
    return Number.isInteger(junctionId) ? { cityId: null, streetId: null, junctionId } : null;
  }
  const split = place.id.lastIndexOf(':');
  const streetId = Number(place.id.slice(split + 1));
  if (split <= 0 || !Number.isInteger(streetId)) return null;
  return { cityId: place.id.slice(0, split), streetId, junctionId: null };
}

/** The document form of a place. */
export function toPlaceDocument(ref: PlaceRef): PlaceDocument {
  return { city_id: ref.cityId, street_id: ref.streetId, junction_id: ref.junctionId };
}

/** A stable key of a place, for lookups. */
export function placeRefKey(ref: PlaceRef): string {
  return ref.junctionId !== null ? `j:${ref.junctionId}` : `c:${ref.cityId}:${ref.streetId ?? ''}`;
}

/** The app place id of a stored place (the inverse of `refOfPlace`). */
export function placeIdOf(ref: PlaceRef): string {
  if (ref.junctionId !== null) return String(ref.junctionId);
  return ref.streetId !== null ? `${ref.cityId}:${ref.streetId}` : (ref.cityId ?? '');
}

function kindOf(ref: PlaceRef): RidePlace['kind'] {
  if (ref.junctionId !== null) return 'junction';
  return ref.streetId !== null ? 'street' : 'city';
}

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The places of a ride's `meeting_points` document, in order; an unreadable entry is skipped. */
export function meetingPointRefs(points: Json): PlaceRef[] {
  if (!Array.isArray(points)) return [];
  return points.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const cityId = typeof entry['city_id'] === 'string' ? entry['city_id'] : null;
    const streetId = typeof entry['street_id'] === 'number' ? entry['street_id'] : null;
    const junctionId = typeof entry['junction_id'] === 'number' ? entry['junction_id'] : null;
    return cityId !== null || junctionId !== null ? [{ cityId, streetId, junctionId }] : [];
  });
}

function pointOf(value: unknown): { lat: number; lng: number } | null {
  return parseWkbPoint(value);
}

/** Labels and points of `refs`, keyed by `placeRefKey`; a place the catalogs no longer hold is absent. */
export async function resolvePlaces(client: Client, refs: readonly PlaceRef[]): Promise<Map<string, RidePlace>> {
  const out = new Map<string, RidePlace>();
  if (refs.length === 0) return out;
  const junctionIds = [...new Set(refs.flatMap((ref) => (ref.junctionId !== null ? [ref.junctionId] : [])))];
  const cityIds = [...new Set(refs.flatMap((ref) => (ref.cityId !== null ? [ref.cityId] : [])))];
  const streetIds = [...new Set(refs.flatMap((ref) => (ref.streetId !== null ? [ref.streetId] : [])))];
  const [junctions, cities, streets] = await Promise.all([
    junctionIds.length === 0
      ? { data: [], error: null }
      : client.from('road_junctions').select('junction_id, name_he, location').in('junction_id', junctionIds),
    cityIds.length === 0
      ? { data: [], error: null }
      : client.from('cities').select('city_id, name_he, location').in('city_id', cityIds),
    streetIds.length === 0
      ? { data: [], error: null }
      : client
          .from('streets')
          .select('city_id, street_id, name_he, location')
          .in('city_id', cityIds)
          .in('street_id', streetIds),
  ]);
  const junctionById = new Map((unwrapCall('table:road_junctions', junctions) ?? []).map((row) => [row.junction_id, row]));
  const cityById = new Map((unwrapCall('table:cities', cities) ?? []).map((row) => [row.city_id, row]));
  const streetByKey = new Map(
    (unwrapCall('table:streets', streets) ?? []).map((row) => [`${row.city_id}:${row.street_id}`, row]),
  );
  for (const ref of refs) {
    const place = resolveOne(ref, junctionById, cityById, streetByKey);
    if (place) out.set(placeRefKey(ref), place);
  }
  return out;
}

type Named = { name_he: string; location: unknown };

function resolveOne(
  ref: PlaceRef,
  junctions: ReadonlyMap<number, Named>,
  cities: ReadonlyMap<string, Named>,
  streets: ReadonlyMap<string, Named>,
): RidePlace | null {
  const city = ref.cityId !== null ? cities.get(ref.cityId) : undefined;
  const street = ref.cityId !== null && ref.streetId !== null ? streets.get(`${ref.cityId}:${ref.streetId}`) : undefined;
  const junction = ref.junctionId !== null ? junctions.get(ref.junctionId) : undefined;
  const named = junction ?? street ?? city;
  const point = pointOf((junction ?? street ?? city)?.location) ?? pointOf(city?.location);
  if (!named || !point) return null;
  const label = street && city ? `${street.name_he}, ${city.name_he}` : named.name_he;
  return { kind: kindOf(ref), id: placeIdOf(ref), label, lat: point.lat, lng: point.lng, cityId: ref.cityId };
}
