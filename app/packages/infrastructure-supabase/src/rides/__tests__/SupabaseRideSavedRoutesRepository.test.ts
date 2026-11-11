import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRideSavedRoutesRepository } from '../SupabaseRideSavedRoutesRepository';
import { HAIFA, TEL_AVIV } from './placeFixtures';

const ROW = {
  id: 'r1', wants: 'offers', origin_city_id: 'IL-001', origin_street_id: null, origin_junction_id: null,
  dest_city_id: 'IL-002', dest_street_id: null, dest_junction_id: null, weekdays: 3, time_from: null, time_to: null,
};
const CATALOG = { cities: ok([TEL_AVIV, HAIFA]), road_junctions: ok([]), streets: ok([]) };

describe('SupabaseRideSavedRoutesRepository', () => {
  it('lists the routes with both ends resolved to official places', async () => {
    const { client } = createFakeClient({ tables: { ride_saved_routes: ok([ROW]), ...CATALOG } });
    const [route] = await new SupabaseRideSavedRoutesRepository(client).listMine();
    expect(route).toMatchObject({ id: 'r1', wants: 'offers', weekdays: [0, 1], timeWindow: null });
    expect(route?.origin).toMatchObject({ kind: 'city', id: 'IL-001', label: 'Tel Aviv' });
    expect(route?.dest.label).toBe('Haifa');
  });

  it('drops a route whose end the catalogs no longer hold', async () => {
    const { client } = createFakeClient({ tables: { ride_saved_routes: ok([ROW]), cities: ok([TEL_AVIV]), road_junctions: ok([]), streets: ok([]) } });
    expect(await new SupabaseRideSavedRoutesRepository(client).listMine()).toEqual([]);
  });

  it('saves a route as place ids and a weekday mask', async () => {
    const { client, calls } = createFakeClient({ tables: { ride_saved_routes: ok(null) } });
    const place = (id: string, label: string) => ({ kind: 'city' as const, id, label, lat: 1, lng: 2, cityId: id });
    await new SupabaseRideSavedRoutesRepository(client).save({
      wants: 'requests', origin: place('IL-001', 'a'), dest: place('IL-002', 'b'), weekdays: [0, 2], timeWindow: null,
    });
    expect(callsTo(calls, 'ride_saved_routes')[0]?.payload).toMatchObject({
      wants: 'requests', origin_city_id: 'IL-001', dest_city_id: 'IL-002', weekdays: 5, time_from: null,
    });
  });

  it('refuses a place it cannot read before calling the server, and keeps the route cap reason', async () => {
    const { client } = createFakeClient({ tables: { ride_saved_routes: fail('P0001', 'saved_routes_limit') } });
    const repo = new SupabaseRideSavedRoutesRepository(client);
    const bad = { kind: 'junction' as const, id: 'x', label: 'x', lat: 0, lng: 0, cityId: null };
    await expect(repo.save({ wants: 'offers', origin: bad, dest: bad, weekdays: [], timeWindow: null })).rejects.toMatchObject({ reason: 'ride_place_invalid' });
    const city = { kind: 'city' as const, id: 'IL-001', label: 'a', lat: 0, lng: 0, cityId: 'IL-001' };
    await expect(repo.save({ wants: 'offers', origin: city, dest: city, weekdays: [], timeWindow: null })).rejects.toBeInstanceOf(BackendRuleError);
  });

  it('reports a missing table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({ tables: { ride_saved_routes: fail('PGRST205', 'nope') } });
    await expect(new SupabaseRideSavedRoutesRepository(client).remove('r1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
