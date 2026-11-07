import { describe, expect, it } from 'vitest';
import type { RidePlace } from '../RidePlace';
import { rideNextStop, rideOriginFromHere, shouldNavigateAfterRidePublish } from '../rideDriveNow';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };
const RG: RidePlace = { kind: 'city', id: '8600', label: 'רמת גן', lat: 32.07, lng: 34.82, cityId: '8600' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'מחלף גלילות', lat: 32.081, lng: 34.781, cityId: null };

describe('rideOriginFromHere', () => {
  it('picks the nearest city and skips junctions', () => {
    expect(rideOriginFromHere({ lat: 32.081, lng: 34.781 }, [RG, GLILOT, TLV])).toEqual(TLV);
  });

  it('returns null when the device is far from every city (e.g. abroad)', () => {
    expect(rideOriginFromHere({ lat: 37.33, lng: -122.03 }, [TLV, RG])).toBeNull();
  });

  it('returns null for an empty catalog', () => {
    expect(rideOriginFromHere({ lat: 32.08, lng: 34.78 }, [])).toBeNull();
  });
});

describe('rideNextStop', () => {
  it('is the first meeting point when there is one', () => {
    expect(rideNextStop({ origin: TLV, dest: RG, meetingPoints: [GLILOT] })).toEqual(GLILOT);
  });

  it('is the destination otherwise, and null without one', () => {
    expect(rideNextStop({ origin: TLV, dest: RG, meetingPoints: [] })).toEqual(RG);
    expect(rideNextStop({ origin: TLV, dest: null, meetingPoints: [] })).toBeNull();
  });
});

describe('shouldNavigateAfterRidePublish', () => {
  const all = { isOffer: true, originFromHere: true, leaveNow: true, recurring: false };

  it('is true for a single offer leaving now from here', () => {
    expect(shouldNavigateAfterRidePublish(all)).toBe(true);
  });

  it.each([
    ['a request', { isOffer: false }],
    ['an origin picked by hand', { originFromHere: false }],
    ['a later departure', { leaveNow: false }],
    ['a recurring ride', { recurring: true }],
  ])('is false for %s', (_, change) => {
    expect(shouldNavigateAfterRidePublish({ ...all, ...change })).toBe(false);
  });
});
