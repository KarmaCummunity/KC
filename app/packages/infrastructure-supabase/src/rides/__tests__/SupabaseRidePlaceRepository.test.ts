import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRidePlaceRepository } from '../SupabaseRidePlaceRepository';
import { HAIFA, JUNCTION, TEL_AVIV } from './placeFixtures';

describe('SupabaseRidePlaceRepository', () => {
  it('lists cities first, then junctions, each with its position', async () => {
    const { client } = createFakeClient({ tables: { cities: ok([TEL_AVIV, HAIFA]), road_junctions: ok([JUNCTION]) } });
    const places = await new SupabaseRidePlaceRepository(client).listPlaces();
    expect(places.map((p) => [p.kind, p.id])).toEqual([['city', 'IL-001'], ['city', 'IL-002'], ['junction', '7']]);
    expect(places[0]).toMatchObject({ label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: 'IL-001' });
  });

  it('drops a city without a centre', async () => {
    const { client } = createFakeClient({
      tables: { cities: ok([{ ...TEL_AVIV, location: null }]), road_junctions: ok([]) },
    });
    expect(await new SupabaseRidePlaceRepository(client).listPlaces()).toEqual([]);
  });

  it('reads on while pages come back full and stops at the page cap', async () => {
    const { client } = createFakeClient({ tables: { cities: ok([TEL_AVIV]), road_junctions: ok([]) } });
    await expect(new SupabaseRidePlaceRepository(client, { pageSize: 1, maxPages: 2 }).listPlaces()).rejects.toThrow(/page cap/);
  });

  it('reports a missing catalog as BackendUnavailableError', async () => {
    const { client } = createFakeClient({ tables: { cities: fail('PGRST205', 'no table'), road_junctions: ok([]) } });
    await expect(new SupabaseRidePlaceRepository(client).listPlaces()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
