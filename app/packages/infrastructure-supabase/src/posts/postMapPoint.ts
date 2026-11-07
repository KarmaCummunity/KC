// Map position of a post: its own `geo` point, else its city's centre (cities.lat / lon, FR-FEED-019).
// Rounded to 3 decimals (~100 m), as map_listing_pins does, so no exact address leaves the server shape.

export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function valid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** PostgREST serialises geography(point) as hex (E)WKB: byte order, type (+SRID flag), [srid], x, y. */
export function parseWkbPoint(hex: unknown): MapPoint | null {
  if (typeof hex !== 'string' || hex.length < 42 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  const little = bytes[0] === 1;
  const type = view.getUint32(1, little);
  if ((type & 0xff) !== 1) return null;
  const offset = type & 0x20000000 ? 9 : 5;
  if (bytes.length < offset + 16) return null;
  const lng = view.getFloat64(offset, little);
  const lat = view.getFloat64(offset + 8, little);
  return valid(lat, lng) ? { lat, lng } : null;
}

export function postMapPoint(
  geo: unknown,
  city: { lat?: number | null; lon?: number | null } | null | undefined,
): MapPoint | null {
  const own = parseWkbPoint(geo);
  if (own) return { lat: round3(own.lat), lng: round3(own.lng) };
  const lat = city?.lat;
  const lng = city?.lon;
  if (typeof lat === 'number' && typeof lng === 'number' && valid(lat, lng)) {
    return { lat: round3(lat), lng: round3(lng) };
  }
  return null;
}
