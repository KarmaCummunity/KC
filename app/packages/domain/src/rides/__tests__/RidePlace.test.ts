import { describe, expect, it } from 'vitest';
import {
  RIDE_ROUTE_DETAIL_KEYS,
  nearestCityPlace,
  readRideRoute,
  streetPlaceId,
  withMeetingPoints,
  withRidePlace,
  type RidePlace,
} from '../RidePlace';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };
const JLM: RidePlace = { kind: 'city', id: '3000', label: 'ירושלים', lat: 31.77, lng: 35.22, cityId: '3000' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'מחלף גלילות מערב', lat: 32.14, lng: 34.8, cityId: null };
const DIZENGOFF: RidePlace = { kind: 'street', id: '5000:404', label: 'דיזנגוף, תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };

describe('withRidePlace', () => {
  it('writes one end and leaves the other untouched', () => {
    const out = withRidePlace(withRidePlace({ seats_available: 2 }, 'origin', TLV), 'dest', JLM);
    expect(out).toMatchObject({
      seats_available: 2,
      origin_place_kind: 'city', origin_place_id: '5000', origin_label: 'תל אביב - יפו', origin_city_id: '5000',
      dest_place_id: '3000', dest_lat: 31.77,
    });
  });

  it('writes no city for a junction and clears a previous one', () => {
    const out = withRidePlace(withRidePlace({}, 'origin', TLV), 'origin', GLILOT);
    expect(out.origin_place_kind).toBe('junction');
    expect(out).not.toHaveProperty('origin_city_id');
  });

  it('clears an end', () => {
    expect(withRidePlace(withRidePlace({}, 'dest', JLM), 'dest', null)).toEqual({});
  });

  it('only writes keys the route picker owns', () => {
    const out = withMeetingPoints(withRidePlace(withRidePlace({}, 'origin', TLV), 'dest', GLILOT), [DIZENGOFF]);
    for (const k of Object.keys(out)) expect(RIDE_ROUTE_DETAIL_KEYS).toContain(k);
  });
});

describe('withMeetingPoints', () => {
  it('keeps order, drops duplicates and caps at three', () => {
    const out = withMeetingPoints({}, [GLILOT, DIZENGOFF, GLILOT, TLV, JLM]);
    expect((out.meeting_points as { id: string }[]).map((p) => p.id)).toEqual(['106', '5000:404', '5000']);
  });

  it('removes the key when the list is empty', () => {
    expect(withMeetingPoints({ meeting_points: [] }, [])).toEqual({});
  });
});

describe('readRideRoute', () => {
  it('reads back what the picker wrote', () => {
    const details = withMeetingPoints(withRidePlace(withRidePlace({}, 'origin', GLILOT), 'dest', JLM), [DIZENGOFF]);
    expect(readRideRoute(details)).toEqual({ origin: GLILOT, dest: JLM, meetingPoints: [DIZENGOFF] });
  });

  it('reads a ride stored before places existed as city places', () => {
    const route = readRideRoute({ origin_city_id: '5000', origin_label: 'Tel Aviv', origin_lat: 32.08, origin_lng: 34.78 });
    expect(route.origin).toEqual({ kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' });
  });

  it('ignores incomplete places', () => {
    const route = readRideRoute({ origin_place_kind: 'city', origin_place_id: '5000', meeting_points: [{ kind: 'x' }, null] });
    expect(route).toEqual({ origin: null, dest: null, meetingPoints: [] });
  });
});

describe('helpers', () => {
  it('builds a street place id from city and street', () => {
    expect(streetPlaceId('5000', 404)).toBe('5000:404');
  });

  it('finds the nearest city, skipping junctions', () => {
    expect(nearestCityPlace(32.1, 34.79, [GLILOT, JLM, TLV])?.id).toBe('5000');
    expect(nearestCityPlace(32.1, 34.79, [GLILOT])).toBeNull();
  });
});
