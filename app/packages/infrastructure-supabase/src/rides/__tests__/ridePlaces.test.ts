import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { meetingPointRefs, placeIdOf, placeRefKey, refOfPlace, resolvePlaces, toPlaceDocument } from '../ridePlaces';
import { HAIFA, JUNCTION, TEL_AVIV } from './placeFixtures';

describe('refOfPlace / placeIdOf', () => {
  it('converts a city, a street and a junction both ways', () => {
    const city = refOfPlace({ kind: 'city', id: 'IL-001' });
    const street = refOfPlace({ kind: 'street', id: 'IL-001:55' });
    const junction = refOfPlace({ kind: 'junction', id: '7' });
    expect(city).toEqual({ cityId: 'IL-001', streetId: null, junctionId: null });
    expect(street).toEqual({ cityId: 'IL-001', streetId: 55, junctionId: null });
    expect(junction).toEqual({ cityId: null, streetId: null, junctionId: 7 });
    expect([city, street, junction].map((ref) => placeIdOf(ref!))).toEqual(['IL-001', 'IL-001:55', '7']);
  });

  it('rejects ids it cannot read', () => {
    expect(refOfPlace({ kind: 'junction', id: 'x' })).toBeNull();
    expect(refOfPlace({ kind: 'street', id: 'nope' })).toBeNull();
  });

  it('writes the document the ride payloads use', () => {
    expect(toPlaceDocument({ cityId: 'IL-001', streetId: 5, junctionId: null })).toEqual({
      city_id: 'IL-001',
      street_id: 5,
      junction_id: null,
    });
  });
});

describe('meetingPointRefs', () => {
  it('reads the stored list in order and skips unreadable entries', () => {
    const refs = meetingPointRefs([{ city_id: 'IL-001', street_id: null, junction_id: null, lat: 1, lng: 2 }, 'bad', { junction_id: 7 }]);
    expect(refs.map(placeRefKey)).toEqual(['c:IL-001:', 'j:7']);
    expect(meetingPointRefs(null)).toEqual([]);
  });
});

describe('resolvePlaces', () => {
  it('labels a city, a junction and a street with one query per catalog', async () => {
    const { client, calls } = createFakeClient({
      tables: {
        cities: { data: [TEL_AVIV, HAIFA], error: null },
        road_junctions: { data: [JUNCTION], error: null },
        streets: { data: [{ city_id: 'IL-002', street_id: 3, name_he: 'Herzl', location: null }], error: null },
      },
    });
    const places = await resolvePlaces(client, [
      { cityId: 'IL-001', streetId: null, junctionId: null },
      { cityId: null, streetId: null, junctionId: 7 },
      { cityId: 'IL-002', streetId: 3, junctionId: null },
    ]);
    expect(places.get('c:IL-001:')).toMatchObject({ kind: 'city', label: 'Tel Aviv', lat: 32.08, lng: 34.78 });
    expect(places.get('j:7')).toMatchObject({ kind: 'junction', id: '7', label: 'Gehah', cityId: null });
    expect(places.get('c:IL-002:3')).toMatchObject({ kind: 'street', id: 'IL-002:3', label: 'Herzl, Haifa' });
    expect(calls.map((call) => call.table).sort()).toEqual(['cities', 'road_junctions', 'streets']);
  });

  it('leaves out a place the catalogs no longer hold', async () => {
    const { client } = createFakeClient({ tables: { cities: { data: [], error: null } } });
    expect((await resolvePlaces(client, [{ cityId: 'IL-9', streetId: null, junctionId: null }])).size).toBe(0);
  });
});
