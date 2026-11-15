// Fixtures of the ride tests: points as PostgREST serialises them, and the place catalog rows.

/** A geography point as hex EWKB (little endian, SRID 4326). */
export function point(lng: number, lat: number): string {
  const view = new DataView(new ArrayBuffer(25));
  view.setUint8(0, 1);
  view.setUint32(1, 0x20000001, true);
  view.setUint32(5, 4326, true);
  view.setFloat64(9, lng, true);
  view.setFloat64(17, lat, true);
  return Array.from(new Uint8Array(view.buffer), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export const TEL_AVIV = { city_id: 'IL-001', name_he: 'Tel Aviv', location: point(34.78, 32.08) };
export const HAIFA = { city_id: 'IL-002', name_he: 'Haifa', location: point(34.99, 32.79) };
export const JUNCTION = { junction_id: 7, name_he: 'Gehah', location: point(34.9, 32.1) };
