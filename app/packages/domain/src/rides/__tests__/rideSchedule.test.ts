import { describe, expect, it } from 'vitest';
import {
  RIDE_LEAVE_NOW_LEAD_MINUTES,
  rideDepartureFromShortcut,
  rideLeaveNowDeparture,
  rideRepublishSeed,
  rideRouteDistanceKm,
  roundUpToQuarterHour,
  suggestRideArrival,
  withLeaveNowDeparture,
} from '../rideSchedule';
import type { RidePlace, RideRoute } from '../RidePlace';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.0853, lng: 34.7818, cityId: '5000' };
const JLM: RidePlace = { kind: 'city', id: '3000', label: 'Jerusalem', lat: 31.7683, lng: 35.2137, cityId: '3000' };
const route = (meetingPoints: RidePlace[] = []): RideRoute => ({ origin: TLV, dest: JLM, meetingPoints });

describe('rideDepartureFromShortcut', () => {
  const now = new Date(2026, 10, 1, 22, 10); // local time

  it('adds 30 minutes and an hour', () => {
    expect(rideDepartureFromShortcut('in30', now)).toEqual(new Date(2026, 10, 1, 22, 40));
    expect(rideDepartureFromShortcut('in60', now)).toEqual(new Date(2026, 10, 1, 23, 10));
  });

  it('picks tomorrow at 07:00 local time, across a month end', () => {
    expect(rideDepartureFromShortcut('tomorrow0700', new Date(2026, 10, 30, 9, 0))).toEqual(new Date(2026, 11, 1, 7, 0));
  });
});

describe('roundUpToQuarterHour', () => {
  it('rounds up and keeps an exact quarter', () => {
    expect(roundUpToQuarterHour(new Date('2026-11-01T08:01:00Z')).toISOString()).toBe('2026-11-01T08:15:00.000Z');
    expect(roundUpToQuarterHour(new Date('2026-11-01T08:15:00Z')).toISOString()).toBe('2026-11-01T08:15:00.000Z');
  });
});

describe('suggestRideArrival', () => {
  it('adds the straight-line drive at 60 km/h and 15 minutes, rounded up to a quarter', () => {
    // Tel Aviv → Jerusalem is ~54 km straight: 54 min + 15 min = 69 min → 08:00 + 1:09 → 09:15.
    expect(rideRouteDistanceKm(route())).toBeGreaterThan(50);
    expect(suggestRideArrival(new Date('2026-11-01T08:00:00Z'), route())?.toISOString()).toBe('2026-11-01T09:15:00.000Z');
  });

  it('measures the path through the meeting points', () => {
    const viaHaifa: RidePlace = { kind: 'city', id: '4000', label: 'Haifa', lat: 32.8191, lng: 34.9984, cityId: '4000' };
    expect(rideRouteDistanceKm(route([viaHaifa]))).toBeGreaterThan(rideRouteDistanceKm(route()) * 2);
  });

  it('suggests nothing until both ends are known', () => {
    expect(suggestRideArrival(new Date(), { origin: TLV, dest: null, meetingPoints: [] })).toBeNull();
  });
});

describe('rideRepublishSeed', () => {
  it('keeps the route and the offer, drops the times', () => {
    const seed = rideRepublishSeed({
      origin_place_kind: 'city', origin_place_id: '5000', meeting_points: [], seats_available: 2,
      cost_share_ils: 20, departs_at: '2026-11-01T08:00:00Z', arrives_at: '2026-11-01T09:15:00Z',
    });
    expect(seed).toEqual({
      origin_place_kind: 'city', origin_place_id: '5000', meeting_points: [], seats_available: 2, cost_share_ils: 20,
    });
  });
});

describe('rideLeaveNowDeparture', () => {
  it('departs a few minutes ahead, so the departure is still in the future when the ride is saved', () => {
    const now = new Date('2026-11-04T20:00:00Z');
    expect(rideLeaveNowDeparture(now).toISOString()).toBe('2026-11-04T20:05:00.000Z');
    expect(RIDE_LEAVE_NOW_LEAD_MINUTES).toBe(5);
  });
});

describe('withLeaveNowDeparture', () => {
  const now = new Date('2026-11-04T20:30:00Z');

  it('re-times the departure to now plus the lead and keeps the estimated end at the same distance', () => {
    const stale = { departs_at: '2026-11-04T20:05:00.000Z', arrives_at: '2026-11-04T21:15:00.000Z', seats_available: 3 };
    expect(withLeaveNowDeparture(stale, now)).toEqual({
      departs_at: '2026-11-04T20:35:00.000Z',
      arrives_at: '2026-11-04T21:45:00.000Z',
      seats_available: 3,
    });
  });

  it('sets only the departure when there is no estimated end yet', () => {
    expect(withLeaveNowDeparture({ seats_available: 3 }, now)).toEqual({
      departs_at: '2026-11-04T20:35:00.000Z',
      seats_available: 3,
    });
  });

  it('does not touch an estimated end that is not after the departure', () => {
    const odd = { departs_at: '2026-11-04T20:05:00.000Z', arrives_at: '2026-11-04T20:00:00.000Z' };
    expect(withLeaveNowDeparture(odd, now).arrives_at).toBe('2026-11-04T20:00:00.000Z');
  });
});
