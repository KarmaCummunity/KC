import { describe, it, expect } from 'vitest';
import { parseWkbPoint, postMapPoint } from '../postMapPoint';

function ewkbHex(lng: number, lat: number, opts: { srid?: boolean; little?: boolean } = {}): string {
  const { srid = true, little = true } = opts;
  const buf = new ArrayBuffer(srid ? 25 : 21);
  const view = new DataView(buf);
  view.setUint8(0, little ? 1 : 0);
  view.setUint32(1, srid ? 0x20000001 : 1, little);
  let o = 5;
  if (srid) {
    view.setUint32(5, 4326, little);
    o = 9;
  }
  view.setFloat64(o, lng, little);
  view.setFloat64(o + 8, lat, little);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

describe('parseWkbPoint', () => {
  it('reads an EWKB point with SRID (PostgREST geography)', () => {
    expect(parseWkbPoint(ewkbHex(34.7818, 32.0853))).toEqual({ lat: 32.0853, lng: 34.7818 });
  });

  it('reads a plain big-endian WKB point', () => {
    expect(parseWkbPoint(ewkbHex(35.2137, 31.7683, { srid: false, little: false }))).toEqual({ lat: 31.7683, lng: 35.2137 });
  });

  it('returns null for missing, malformed or out-of-range values', () => {
    expect(parseWkbPoint(null)).toBeNull();
    expect(parseWkbPoint('not-hex')).toBeNull();
    expect(parseWkbPoint('0101')).toBeNull();
    expect(parseWkbPoint(ewkbHex(200, 32))).toBeNull();
  });
});

describe('postMapPoint', () => {
  it("prefers the post's own point, rounded to ~100 m", () => {
    expect(postMapPoint(ewkbHex(34.78184, 32.08536), { lat: 31, lon: 35 })).toEqual({ lat: 32.085, lng: 34.782 });
  });

  it("falls back to the city's centre", () => {
    expect(postMapPoint(null, { lat: 31.76834, lon: 35.21371 })).toEqual({ lat: 31.768, lng: 35.214 });
  });

  it('is null when neither is known', () => {
    expect(postMapPoint(null, { lat: null, lon: null })).toBeNull();
    expect(postMapPoint(undefined, null)).toBeNull();
  });
});
