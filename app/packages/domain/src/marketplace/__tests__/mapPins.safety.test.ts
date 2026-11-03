// Regression: map crashed after a short pan (#1214 follow-up). Invalid coordinates and
// noisy region events must never reach the native map.
import { describe, expect, it } from 'vitest';
import {
  LOD_REGION, clusterPins, isValidLatLng, regionsNearlyEqual, sanitizeRegion, sanitizeRoute, validMapPins,
  type MarketplaceMapPin,
} from '../mapPins';

const pin = (id: string, lat: number, lng: number): MarketplaceMapPin => ({
  listingId: id, worldSlug: 'items', kindSlug: 'k', direction: 'give', title: id, summary: null, lat, lng, route: null, ride: null,
});

describe('map coordinate safety', () => {
  it('isValidLatLng rejects NaN, Infinity, null and out-of-range', () => {
    expect(isValidLatLng(31.9, 34.8)).toBe(true);
    expect(isValidLatLng(-90, 180)).toBe(true);
    for (const [a, b] of [[NaN, 34], [31, NaN], [Infinity, 1], [91, 0], [0, -181], [null, 1], [undefined, 1], ['31', 34]]) {
      expect(isValidLatLng(a, b)).toBe(false);
    }
  });

  it('clusterPins skips pins with invalid coordinates and never emits NaN clusters', () => {
    const bad = [pin('a', 31.95, 34.89), pin('nan', NaN, 34.89), pin('null', null as unknown as number, 34.9), pin('far', 200, 34)];
    const clusters = clusterPins(bad, LOD_REGION);
    expect(clusters.flatMap((c) => c.pins.map((p) => p.listingId))).toEqual(['a']);
    for (const c of clusters) expect(isValidLatLng(c.lat, c.lng)).toBe(true);
  });

  it('clusterPins survives a degenerate region (NaN/zero deltas)', () => {
    const pins = [pin('a', 31.95, 34.89), pin('b', 31.951, 34.891)];
    for (const r of [{ ...LOD_REGION, latitudeDelta: NaN }, { ...LOD_REGION, latitudeDelta: 0, longitudeDelta: 0 }]) {
      const out = clusterPins(pins, r);
      expect(out.length).toBeGreaterThan(0);
      for (const c of out) expect(Number.isFinite(c.lat) && Number.isFinite(c.lng)).toBe(true);
    }
  });

  it('validMapPins filters bad rows', () => {
    expect(validMapPins([pin('a', 1, 1), pin('b', NaN, 1)]).map((p) => p.listingId)).toEqual(['a']);
  });

  it('sanitizeRegion clamps deltas and rejects invalid regions', () => {
    expect(sanitizeRegion(null)).toBeNull();
    expect(sanitizeRegion(undefined)).toBeNull();
    expect(sanitizeRegion({ ...LOD_REGION, latitude: NaN })).toBeNull();
    expect(sanitizeRegion({ ...LOD_REGION, longitudeDelta: Infinity })).toBeNull();
    expect(sanitizeRegion({ latitude: 1, longitude: 1 })).toBeNull();
    const r = sanitizeRegion({ latitude: 1, longitude: 2, latitudeDelta: -0.5, longitudeDelta: 0 })!;
    expect(r.latitudeDelta).toBe(0.5);
    expect(r.longitudeDelta).toBeGreaterThan(0);
    expect(sanitizeRegion({ latitude: 0, longitude: 0, latitudeDelta: 1000, longitudeDelta: 1000 })).toMatchObject({ latitudeDelta: 180, longitudeDelta: 360 });
  });

  it('regionsNearlyEqual ignores sub-pixel jitter but detects a real pan', () => {
    expect(regionsNearlyEqual(LOD_REGION, { ...LOD_REGION, latitude: LOD_REGION.latitude + 1e-6 })).toBe(true);
    expect(regionsNearlyEqual(LOD_REGION, { ...LOD_REGION, latitude: LOD_REGION.latitude + 0.01 })).toBe(false);
    expect(regionsNearlyEqual(LOD_REGION, { ...LOD_REGION, latitudeDelta: 0.1 })).toBe(false);
  });

  it('sanitizeRoute drops routes with any invalid endpoint', () => {
    const ok = { originLat: 31.9, originLng: 34.8, destLat: 32.0, destLng: 34.9 };
    expect(sanitizeRoute(ok)).toBe(ok);
    expect(sanitizeRoute(null)).toBeNull();
    expect(sanitizeRoute({ ...ok, destLat: NaN })).toBeNull();
    expect(sanitizeRoute({ ...ok, originLng: null as unknown as number })).toBeNull();
  });
});
