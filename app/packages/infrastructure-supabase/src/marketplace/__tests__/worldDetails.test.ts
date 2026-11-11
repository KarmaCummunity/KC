import { describe, expect, it } from 'vitest';
import {
  eventDetailColumns, foodDetailColumns, freeDetails, israelTimeOfDay, rideCityId, rideDetailColumns, rideDetailsFromRow,
} from '../worldDetails';

const ROUTE = {
  origin_place_kind: 'street', origin_place_id: 'IL-001:55', origin_label: 'a', origin_lat: 32, origin_lng: 34, origin_city_id: 'IL-001',
  dest_place_kind: 'junction', dest_place_id: '7', dest_label: 'b', dest_lat: 32.5, dest_lng: 34.5,
  meeting_points: [{ kind: 'city', id: 'IL-002', label: 'c', lat: 32.2, lng: 34.2, city_id: 'IL-002' }],
};

describe('rideDetailColumns', () => {
  it('turns the route and schedule into the ride columns of an offer', () => {
    expect(
      rideDetailColumns({ ...ROUTE, departs_at: '2030-01-01T07:00:00Z', arrives_at: '2030-01-01T08:00:00Z', seats_available: 3, luggage: true }, 'offer'),
    ).toEqual({
      origin_city_id: 'IL-001', origin_street_id: 55, origin_junction_id: null,
      dest_city_id: null, dest_street_id: null, dest_junction_id: 7,
      meeting_points: [{ city_id: 'IL-002', street_id: null, junction_id: null }],
      departs_at: '2030-01-01T07:00:00Z', arrives_at: '2030-01-01T08:00:00Z', seats: 3, luggage: true,
      reward_model: 'free', cost_share_ils: null,
    });
  });

  it('uses the passengers of a request and keeps an expense share with its amount', () => {
    const columns = rideDetailColumns({ ...ROUTE, departs_at: 'x', passengers: 2, reward_model: 'expense_share', cost_share_ils: 12 }, 'request');
    expect(columns).toMatchObject({ seats: 2, reward_model: 'expense_share', cost_share_ils: 12 });
  });

  it('is null when a route end is missing', () => {
    expect(rideDetailColumns({ departs_at: 'x' }, 'offer')).toBeNull();
  });
});

describe('rideCityId', () => {
  it('prefers the origin city, then the destination city', () => {
    expect(rideCityId({ origin_city_id: 'A', dest_city_id: 'B' })).toBe('A');
    expect(rideCityId({ dest_city_id: 'B' })).toBe('B');
    expect(rideCityId({})).toBeNull();
  });
});

describe('event and food columns', () => {
  it('maps an event window, capacity, policy and address', () => {
    expect(eventDetailColumns({ starts_at: 's', ends_at: 'e', capacity: 20, registration_policy: 'manual', address: 'Hall' })).toEqual({
      starts_at: 's', ends_at: 'e', capacity: 20, registration_policy: 'manual', address_label: 'Hall',
    });
    expect(eventDetailColumns({ starts_at: 's', ends_at: 'e' })).toMatchObject({ capacity: null, registration_policy: 'automatic' });
  });

  it('maps the food offer, turning the yes / no answer into a boolean', () => {
    expect(foodDetailColumns({ expires_at: 'x', allergens: ['milk', 3], kosher: 'yes' })).toEqual({ expires_at: 'x', allergens: ['milk'], kosher: true });
    expect(foodDetailColumns({ expires_at: 'x', kosher: 'no' })).toMatchObject({ kosher: false });
    expect(foodDetailColumns({ expires_at: 'x' })).toMatchObject({ kosher: null, allergens: [] });
  });
});

describe('freeDetails', () => {
  it('keeps only the keys no detail table owns', () => {
    expect(freeDetails({ ...ROUTE, departs_at: 'x', pickup_mode: 'pickup', note: null }, 'rides')).toEqual({ pickup_mode: 'pickup' });
    expect(freeDetails({ starts_at: 's', org_id: 'o', theme: 'x' }, 'event')).toEqual({ theme: 'x' });
    expect(freeDetails({ expires_at: 'x', pickup_mode: 'pickup' }, 'food')).toEqual({ pickup_mode: 'pickup' });
    expect(freeDetails({ a: 1, b: undefined }, 'plain')).toEqual({ a: 1 });
  });
});

describe('rideDetailsFromRow', () => {
  it('writes the form-style details with both ends and the stops', () => {
    const place = (id: string, kind: 'city' | 'junction') => ({ kind, id, label: id, lat: 1, lng: 2, cityId: kind === 'city' ? id : null });
    const details = rideDetailsFromRow(
      { departs_at: 'd', arrives_at: 'a', seats: 3, luggage: false, reward_model: 'free', cost_share_ils: null },
      'offer', place('IL-001', 'city'), place('7', 'junction'), [place('IL-002', 'city')],
    );
    expect(details).toMatchObject({
      departs_at: 'd', arrives_at: 'a', seats_available: 3, origin_place_kind: 'city', origin_city_id: 'IL-001',
      dest_place_kind: 'junction', dest_place_id: '7',
    });
    expect(details).not.toHaveProperty('dest_city_id');
    expect(details['meeting_points']).toEqual([{ kind: 'city', id: 'IL-002', label: 'IL-002', lat: 1, lng: 2, city_id: 'IL-002' }]);
  });
});

describe('israelTimeOfDay', () => {
  it('states the Israel-local time of an instant', () => {
    expect(israelTimeOfDay('2026-01-15T05:30:00Z')).toBe('07:30');
    expect(israelTimeOfDay('2026-07-15T05:30:00Z')).toBe('08:30');
  });
});
