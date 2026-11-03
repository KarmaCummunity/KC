import { describe, expect, it } from 'vitest';
import { mapPinRow } from '../mapPinRow';

const base = {
  listing_id: 'l1', world_slug: 'items', kind_slug: 'k', direction: 'give', title: 'T', summary: null,
  lat: 31.95, lng: 34.89, origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
  origin_label: null, dest_label: null, departs_at: null, seats: null,
};

describe('mapPinRow', () => {
  it('maps a non-ride pin', () => {
    expect(mapPinRow(base)).toMatchObject({ listingId: 'l1', direction: 'give', route: null, ride: null });
  });
  it('maps a ride with route and request direction', () => {
    const p = mapPinRow({
      ...base, world_slug: 'rides', direction: 'request', origin_lat: 31.9, origin_lng: 34.8, dest_lat: 32.1,
      dest_lng: 34.7, origin_label: 'לוד', dest_label: 'תל אביב', departs_at: '2026-10-29T08:00:00Z', seats: 2,
    });
    expect(p.direction).toBe('request');
    expect(p.route).toEqual({ originLat: 31.9, originLng: 34.8, destLat: 32.1, destLng: 34.7 });
    expect(p.ride).toMatchObject({ originLabel: 'לוד', seats: 2 });
  });
  it('ride without full coords has no route', () => {
    expect(mapPinRow({ ...base, world_slug: 'rides', origin_lat: 1 }).route).toBeNull();
  });
});
