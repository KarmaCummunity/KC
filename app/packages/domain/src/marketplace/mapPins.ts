// Pure map helpers for the convenient map (Epic #1166): pins, viewport, grid clustering.

export interface MapRegion {
  readonly latitude: number;
  readonly longitude: number;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface MapBounds {
  readonly swLat: number;
  readonly swLng: number;
  readonly neLat: number;
  readonly neLng: number;
}

export interface MarketplaceMapPin {
  readonly listingId: string;
  readonly worldSlug: string;
  readonly kindSlug: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  readonly summary: string | null;
  readonly lat: number;
  readonly lng: number;
  /** Rides only: approximate route endpoints (may be null). */
  readonly route: {
    readonly originLat: number;
    readonly originLng: number;
    readonly destLat: number;
    readonly destLng: number;
  } | null;
  readonly ride: {
    readonly originLabel: string | null;
    readonly destLabel: string | null;
    readonly departsAt: string | null;
    readonly seats: number | null;
  } | null;
}

export interface MapPinCluster {
  readonly key: string;
  readonly lat: number;
  readonly lng: number;
  readonly pins: readonly MarketplaceMapPin[];
  /** World of the cluster when all pins share one, else null (mixed). */
  readonly worldSlug: string | null;
}

/** Lod city center — default focus when the user's location is unknown. */
export const LOD_REGION: MapRegion = {
  latitude: 31.9516,
  longitude: 34.8953,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

export function regionToBounds(r: MapRegion): MapBounds {
  return {
    swLat: r.latitude - r.latitudeDelta / 2,
    swLng: r.longitude - r.longitudeDelta / 2,
    neLat: r.latitude + r.latitudeDelta / 2,
    neLng: r.longitude + r.longitudeDelta / 2,
  };
}

/** True when `inner` fits inside `outer` (used to decide "search this area"). */
export function boundsContain(outer: MapBounds, inner: MapBounds): boolean {
  return inner.swLat >= outer.swLat && inner.swLng >= outer.swLng && inner.neLat <= outer.neLat && inner.neLng <= outer.neLng;
}

/** Region that frames every point with padding (min span so a single point is not over-zoomed). */
export function regionForPoints(points: ReadonlyArray<{ lat: number; lng: number }>, minDelta = 0.01): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, minDelta),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, minDelta),
  };
}

/**
 * Grid clustering relative to the visible region: the screen is split into
 * ~`cells` columns; pins in the same cell merge. Zooming in splits clusters.
 */
export function clusterPins(pins: readonly MarketplaceMapPin[], region: MapRegion, cells = 7): MapPinCluster[] {
  const safe = sanitizeRegion(region) ?? LOD_REGION;
  const cellLat = Math.max(safe.latitudeDelta / cells, 1e-6);
  const cellLng = Math.max(safe.longitudeDelta / cells, 1e-6);
  const groups = new Map<string, MarketplaceMapPin[]>();
  for (const p of pins) {
    if (!isValidLatLng(p.lat, p.lng)) continue;
    const key = `${Math.floor(p.lat / cellLat)}:${Math.floor(p.lng / cellLng)}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const out: MapPinCluster[] = [];
  for (const [key, g] of groups) {
    const lat = g.reduce((s, p) => s + p.lat, 0) / g.length;
    const lng = g.reduce((s, p) => s + p.lng, 0) / g.length;
    const first = g[0]!.worldSlug;
    const worldSlug = g.every((p) => p.worldSlug === first) ? first : null;
    out.push({ key: g.length === 1 ? g[0]!.listingId : `c:${key}`, lat, lng, pins: g, worldSlug });
  }
  return out;
}

/** All pins share (almost) the same spot — zooming won't split them; show a list instead. */
export function isStackedCluster(c: MapPinCluster, epsilon = 0.0015): boolean {
  return c.pins.every((p) => Math.abs(p.lat - c.lat) < epsilon && Math.abs(p.lng - c.lng) < epsilon);
}

/** Map pin colors per world (shared across native + web). */
export const MAP_WORLD_COLORS: Readonly<Record<string, string>> = {
  items: '#F97316',
  food: '#16A34A',
  rides: '#2563EB',
  knowledge: '#9333EA',
  time: '#0891B2',
  money: '#CA8A04',
};

export function mapWorldColor(worldSlug: string | null): string {
  return (worldSlug && MAP_WORLD_COLORS[worldSlug]) || '#475569';
}

/** Great-circle distance in km (haversine). */
export function pinDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Expand bounds around their center (prefetch a margin so small pans need no reload). */
export function expandRegion(r: MapRegion, factor = 1.6): MapRegion {
  return { ...r, latitudeDelta: r.latitudeDelta * factor, longitudeDelta: r.longitudeDelta * factor };
}

/** Finite latitude/longitude inside the valid globe range (native maps crash on NaN/out-of-range). */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

const MIN_DELTA = 1e-5;
const MAX_LAT_DELTA = 180;
const MAX_LNG_DELTA = 360;

/** Returns a region safe to hand to a native map (finite, in range, positive deltas) or null. */
export function sanitizeRegion(r: Partial<MapRegion> | null | undefined): MapRegion | null {
  if (!r || !isValidLatLng(r.latitude, r.longitude)) return null;
  const { latitudeDelta: dLat, longitudeDelta: dLng } = r;
  if (typeof dLat !== 'number' || typeof dLng !== 'number' || !Number.isFinite(dLat) || !Number.isFinite(dLng)) return null;
  return {
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    latitudeDelta: Math.min(Math.max(Math.abs(dLat), MIN_DELTA), MAX_LAT_DELTA),
    longitudeDelta: Math.min(Math.max(Math.abs(dLng), MIN_DELTA), MAX_LNG_DELTA),
  };
}

/** True when two regions differ by less than a tiny fraction of the viewport (skip redundant state updates). */
export function regionsNearlyEqual(a: MapRegion, b: MapRegion, tolerance = 0.01): boolean {
  const eps = (d: number) => Math.max(d * tolerance, 1e-7);
  return (
    Math.abs(a.latitude - b.latitude) < eps(a.latitudeDelta) &&
    Math.abs(a.longitude - b.longitude) < eps(a.longitudeDelta) &&
    Math.abs(a.latitudeDelta - b.latitudeDelta) < eps(a.latitudeDelta) &&
    Math.abs(a.longitudeDelta - b.longitudeDelta) < eps(a.longitudeDelta)
  );
}

/** Route with all four endpoints valid, else null (a broken route must not reach the native map). */
export function sanitizeRoute(route: MarketplaceMapPin['route']): MarketplaceMapPin['route'] {
  if (!route) return null;
  if (!isValidLatLng(route.originLat, route.originLng) || !isValidLatLng(route.destLat, route.destLng)) return null;
  return route;
}

/** Drop pins whose coordinates are missing/NaN/out of range (defensive: RPC rows can carry nulls). */
export function validMapPins(pins: readonly MarketplaceMapPin[]): MarketplaceMapPin[] {
  return pins.filter((p) => isValidLatLng(p.lat, p.lng));
}
