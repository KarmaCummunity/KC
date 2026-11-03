import { describe, expect, it } from 'vitest';
import {
  LOD_REGION, boundsContain, pinDistanceKm, expandRegion, clusterPins, isStackedCluster, mapWorldColor, regionForPoints, regionToBounds,
  type MarketplaceMapPin,
} from '../mapPins';

const pin = (id: string, lat: number, lng: number, worldSlug = 'items'): MarketplaceMapPin => ({
  listingId: id, worldSlug, kindSlug: 'k', direction: 'give', title: id, summary: null, lat, lng, route: null, ride: null,
});

describe('mapPins', () => {
  it('regionToBounds / boundsContain', () => {
    const b = regionToBounds(LOD_REGION);
    expect(b.swLat).toBeCloseTo(31.9216);
    expect(b.neLng).toBeCloseTo(34.9253);
    expect(boundsContain(b, regionToBounds({ ...LOD_REGION, latitudeDelta: 0.01, longitudeDelta: 0.01 }))).toBe(true);
    expect(boundsContain(b, regionToBounds({ ...LOD_REGION, latitude: 32.5 }))).toBe(false);
  });

  it('clusters nearby pins and splits when zoomed in', () => {
    const pins = [pin('a', 31.951, 34.895), pin('b', 31.952, 34.896, 'food'), pin('c', 31.99, 34.95)];
    const wide = clusterPins(pins, { ...LOD_REGION, latitudeDelta: 1, longitudeDelta: 1 });
    expect(wide.some((c) => c.pins.length >= 2)).toBe(true);
    const merged = wide.find((c) => c.pins.length >= 2)!;
    expect(merged.worldSlug).toBeNull();
    const tight = clusterPins(pins, { ...LOD_REGION, latitudeDelta: 0.002, longitudeDelta: 0.002 });
    expect(tight).toHaveLength(3);
    expect(tight.find((c) => c.key === 'c')?.worldSlug).toBe('items');
  });

  it('stacked detection and region framing', () => {
    const [c] = clusterPins([pin('a', 31.95, 34.89), pin('b', 31.95, 34.89)], LOD_REGION);
    expect(isStackedCluster(c!)).toBe(true);
    expect(regionForPoints([])).toBeNull();
    const r = regionForPoints([{ lat: 31, lng: 34 }, { lat: 32, lng: 35 }])!;
    expect(r.latitude).toBe(31.5);
    expect(r.latitudeDelta).toBeCloseTo(1.5);
    expect(regionForPoints([{ lat: 31, lng: 34 }])!.latitudeDelta).toBe(0.01);
  });

  it('colors', () => {
    expect(mapWorldColor('rides')).toBe('#2563EB');
    expect(mapWorldColor(null)).toBe('#475569');
    expect(mapWorldColor('zzz')).toBe('#475569');
  });

  it('distance and expand', () => {
    expect(pinDistanceKm({ lat: 31.9516, lng: 34.8953 }, { lat: 32.0853, lng: 34.7818 })).toBeGreaterThan(17);
    expect(pinDistanceKm({ lat: 31.9516, lng: 34.8953 }, { lat: 32.0853, lng: 34.7818 })).toBeLessThan(19);
    expect(expandRegion(LOD_REGION, 2).latitudeDelta).toBeCloseTo(0.12);
  });
});
