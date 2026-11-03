// A ride place — origin, destination or meeting point — picked only from official catalogs:
// a city, a street inside a city, or a named junction / interchange
// (docs/spec/05_giving_worlds.md §5.3 step 2, D71; gap G45). The server re-resolves every
// place on write (0512), so these helpers only shape what the form sends and reads back.

export const RIDE_PLACE_KINDS = ['city', 'street', 'junction'] as const;
export type RidePlaceKind = (typeof RIDE_PLACE_KINDS)[number];

/** A ride may stop at up to three meeting points between origin and destination. */
export const RIDE_MAX_MEETING_POINTS = 3;

export interface RidePlace {
  readonly kind: RidePlaceKind;
  /** city → city id; street → `<cityId>:<streetId>`; junction → junction id. */
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  /** The place's city; a junction belongs to none. */
  readonly cityId: string | null;
}

export type RideRouteEnd = 'origin' | 'dest';

export interface RideRoute {
  readonly origin: RidePlace | null;
  readonly dest: RidePlace | null;
  readonly meetingPoints: readonly RidePlace[];
}

/** Ride detail keys written by the route picker, hidden from the generic schema fields. */
export const RIDE_ROUTE_DETAIL_KEYS = [
  'origin_place_kind', 'origin_place_id', 'origin_label', 'origin_lat', 'origin_lng', 'origin_city_id',
  'dest_place_kind', 'dest_place_id', 'dest_label', 'dest_lat', 'dest_lng', 'dest_city_id',
  'meeting_points',
] as const;

const END_FIELDS = ['place_kind', 'place_id', 'label', 'lat', 'lng', 'city_id'] as const;

export function isRidePlaceKind(value: unknown): value is RidePlaceKind {
  return typeof value === 'string' && (RIDE_PLACE_KINDS as readonly string[]).includes(value);
}

/** The id of a street place: streets are unique only inside their city. */
export function streetPlaceId(cityId: string, streetId: number | string): string {
  return `${cityId}:${streetId}`;
}

/** Two places are the same when kind and id match (labels may differ in wording). */
export function isSameRidePlace(a: RidePlace, b: RidePlace): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Writes one route end into ride details; `null` clears it. Other keys are untouched. */
export function withRidePlace(
  details: Record<string, unknown>,
  end: RideRouteEnd,
  place: RidePlace | null,
): Record<string, unknown> {
  const next = { ...details };
  for (const field of END_FIELDS) delete next[`${end}_${field}`];
  if (!place) return next;
  next[`${end}_place_kind`] = place.kind;
  next[`${end}_place_id`] = place.id;
  next[`${end}_label`] = place.label;
  next[`${end}_lat`] = place.lat;
  next[`${end}_lng`] = place.lng;
  if (place.cityId) next[`${end}_city_id`] = place.cityId;
  return next;
}

/**
 * Writes the meeting points in order, dropping duplicates and anything past the cap;
 * an empty list removes the key.
 */
export function withMeetingPoints(
  details: Record<string, unknown>,
  places: readonly RidePlace[],
): Record<string, unknown> {
  const next = { ...details };
  const unique = places.filter((p, i) => places.findIndex((q) => isSameRidePlace(p, q)) === i);
  const kept = unique.slice(0, RIDE_MAX_MEETING_POINTS);
  if (kept.length === 0) {
    delete next.meeting_points;
    return next;
  }
  next.meeting_points = kept.map((p) => ({
    kind: p.kind, id: p.id, label: p.label, lat: p.lat, lng: p.lng, city_id: p.cityId,
  }));
  return next;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** One place from loose JSON, or null when it is not a complete, pinnable place. */
function parsePlace(raw: Record<string, unknown>, kindKey: string, idKey: string, prefix = ''): RidePlace | null {
  const kind = raw[kindKey];
  const id = text(raw[idKey]);
  const label = text(raw[`${prefix}label`]);
  const lat = raw[`${prefix}lat`];
  const lng = raw[`${prefix}lng`];
  if (!isRidePlaceKind(kind) || !id || !label || !finite(lat) || !finite(lng)) return null;
  return { kind, id, label, lat, lng, cityId: text(raw[`${prefix}city_id`]) };
}

/**
 * Reads the route back from ride details. A ride stored before places existed (only
 * `<end>_city_id`) reads as a city place.
 */
export function readRideRoute(details: Record<string, unknown>): RideRoute {
  const end = (e: RideRouteEnd): RidePlace | null => {
    if (details[`${e}_place_kind`] === undefined && text(details[`${e}_city_id`])) {
      return parsePlace({ ...details, [`${e}_place_kind`]: 'city', [`${e}_place_id`]: details[`${e}_city_id`] },
        `${e}_place_kind`, `${e}_place_id`, `${e}_`);
    }
    return parsePlace(details, `${e}_place_kind`, `${e}_place_id`, `${e}_`);
  };
  const rawPoints = Array.isArray(details.meeting_points) ? details.meeting_points : [];
  const meetingPoints = rawPoints.flatMap((p) => {
    const place = p && typeof p === 'object' ? parsePlace(p as Record<string, unknown>, 'kind', 'id') : null;
    return place ? [place] : [];
  });
  return { origin: end('origin'), dest: end('dest'), meetingPoints };
}

/** The city nearest a point, by straight-line distance (for a junction with no city). */
export function nearestCityPlace(lat: number, lng: number, places: readonly RidePlace[]): RidePlace | null {
  let best: RidePlace | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of places) {
    if (p.kind !== 'city') continue;
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}
