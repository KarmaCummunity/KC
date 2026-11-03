import { describe, expect, it, vi } from 'vitest';
import { SupabaseRidePlaceRepository } from '../SupabaseRidePlaceRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRidePlaceRepository>[0];
type Result = { data: unknown; error: { message: string } | null };

/** Client double whose `rpc(...).range(from, to)` answers one result per call, in order. */
function repoWith(results: Result[], pageOpts?: { pageSize?: number; maxPages?: number }) {
  const range = vi.fn();
  results.forEach((result) => range.mockResolvedValueOnce(result));
  const rpc = vi.fn().mockReturnValue({ range });
  const client = { rpc, from: vi.fn() } as unknown as AnyClient;
  return { rpc, range, repo: new SupabaseRidePlaceRepository(client, pageOpts) };
}

const CITY = { place_kind: 'city', place_id: '6500', label: 'חדרה', city_id: '6500', lat: 32.43, lng: 34.91 };
const JUNCTION = { place_kind: 'junction', place_id: '106', label: 'מחלף גלילות מערב', city_id: null, lat: 32.14, lng: 34.8 };
const TEL_AVIV = { place_kind: 'city', place_id: '5000', label: 'תל אביב - יפו', city_id: '5000', lat: 32.08, lng: 34.78 };

describe('SupabaseRidePlaceRepository', () => {
  it('maps cities and junctions to ride places', async () => {
    const { rpc, range, repo } = repoWith([{ data: [CITY, JUNCTION], error: null }]);
    await expect(repo.listPlaces()).resolves.toEqual([
      { kind: 'city', id: '6500', label: 'חדרה', lat: 32.43, lng: 34.91, cityId: '6500' },
      { kind: 'junction', id: '106', label: 'מחלף גלילות מערב', lat: 32.14, lng: 34.8, cityId: null },
    ]);
    expect(rpc).toHaveBeenCalledWith('list_ride_places');
    // A single short page (< 1000 rows) ends the read after one round-trip.
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith(0, 999);
  });

  it('keeps reading pages past the PostgREST row cap until a short page arrives (KC#1411)', async () => {
    const { range, repo } = repoWith(
      [
        { data: [CITY, JUNCTION], error: null },
        { data: [TEL_AVIV], error: null },
      ],
      { pageSize: 2 },
    );
    const places = await repo.listPlaces();
    expect(places.map((p) => p.label)).toEqual(['חדרה', 'מחלף גלילות מערב', 'תל אביב - יפו']);
    expect(range.mock.calls).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('drops a row repeated across a page boundary', async () => {
    const { repo } = repoWith(
      [
        { data: [CITY, JUNCTION], error: null },
        { data: [JUNCTION], error: null },
      ],
      { pageSize: 2 },
    );
    await expect(repo.listPlaces()).resolves.toHaveLength(2);
  });

  it('stops at the page cap instead of looping on a server that never sends a short page', async () => {
    const full = { data: [CITY, JUNCTION], error: null };
    const { range, repo } = repoWith([full, full, full], { pageSize: 2, maxPages: 3 });
    await expect(repo.listPlaces()).rejects.toThrow('page cap');
    expect(range).toHaveBeenCalledTimes(3);
  });

  it('drops rows of an unknown kind or without coordinates', async () => {
    const { repo } = repoWith([{ data: [{ ...CITY, place_kind: 'mall' }, { ...JUNCTION, lat: null }], error: null }]);
    await expect(repo.listPlaces()).resolves.toEqual([]);
  });

  it('throws the server error', async () => {
    const { repo } = repoWith([{ data: null, error: { message: 'boom' } }]);
    await expect(repo.listPlaces()).rejects.toThrow('boom');
  });
});
