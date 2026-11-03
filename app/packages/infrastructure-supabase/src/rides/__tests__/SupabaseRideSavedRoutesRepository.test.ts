import { describe, expect, it, vi } from 'vitest';
import type { RidePlace } from '@kc/domain';
import { SupabaseRideSavedRoutesRepository, mapRouteRow } from '../SupabaseRideSavedRoutesRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideSavedRoutesRepository>[0];

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'Glilot West', lat: 32.14, lng: 34.8, cityId: null };
const ROW = {
  route_id: 'r1', wants: 'offers', origin_place_kind: 'city', origin_place_id: '5000', origin_label: 'Tel Aviv',
  origin_lat: 32.08, origin_lng: 34.78, dest_place_kind: 'junction', dest_place_id: '106', dest_label: 'Glilot West',
  dest_lat: 32.14, dest_lng: 34.8, weekdays: 0b11111, time_from: '06:00:00', time_to: '10:00:00',
};

/** A fake query chain: every builder call returns the chain; awaiting it yields `result`. */
function clientWith(result: { data?: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'insert', 'delete', 'eq']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls[m] = args;
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const from = vi.fn(() => chain);
  return { calls, from, repo: new SupabaseRideSavedRoutesRepository({ from, rpc: vi.fn() } as unknown as AnyClient) };
}

describe('SupabaseRideSavedRoutesRepository', () => {
  it('maps my routes with their days and hours', async () => {
    const { from, repo } = clientWith({ data: [ROW], error: null });
    await expect(repo.listMine()).resolves.toEqual([{
      id: 'r1', wants: 'offers', origin: { ...TLV, cityId: null }, dest: GLILOT,
      weekdays: [0, 1, 2, 3, 4], timeWindow: 'morning',
    }]);
    expect(from).toHaveBeenCalledWith('ride_saved_routes');
  });

  it('throws when listMine query fails', async () => {
    const { repo } = clientWith({ error: { message: 'db error' } });
    await expect(repo.listMine()).rejects.toThrow('db error');
  });

  it('saves places, the weekday mask and the hour window', async () => {
    const { calls, repo } = clientWith({ error: null });
    await repo.save({ wants: 'requests', origin: TLV, dest: GLILOT, weekdays: [0, 4], timeWindow: 'evening' });
    expect(calls.insert?.[0]).toMatchObject({
      wants: 'requests', origin_place_kind: 'city', origin_place_id: '5000', dest_place_kind: 'junction',
      dest_place_id: '106', weekdays: 0b10001, time_from: '15:00', time_to: '21:00',
    });
  });

  it('saves with null time_from and time_to when timeWindow is null', async () => {
    const { calls, repo } = clientWith({ error: null });
    await repo.save({ wants: 'offers', origin: TLV, dest: GLILOT, weekdays: null, timeWindow: null });
    expect(calls.insert?.[0]).toMatchObject({
      time_from: null,
      time_to: null,
    });
  });

  it('removes one route and surfaces server errors', async () => {
    const ok = clientWith({ error: null });
    await ok.repo.remove('r1');
    expect(ok.calls.eq).toEqual(['route_id', 'r1']);
    await expect(clientWith({ error: { message: 'saved_routes_limit' } }).repo.save({
      wants: 'offers', origin: TLV, dest: GLILOT, weekdays: null, timeWindow: null,
    })).rejects.toThrow('saved_routes_limit');
    await expect(clientWith({ error: { message: 'delete error' } }).repo.remove('r1')).rejects.toThrow('delete error');
  });

  describe('mapRouteRow edge cases', () => {
    it('drops rows with invalid wants', () => {
      expect(mapRouteRow({ ...ROW, wants: 'invalid' } as unknown as Parameters<typeof mapRouteRow>[0])).toBeNull();
    });

    it('drops rows with invalid origin or dest place kind', () => {
      expect(mapRouteRow({ ...ROW, origin_place_kind: 'unknown' } as unknown as Parameters<typeof mapRouteRow>[0])).toBeNull();
      expect(mapRouteRow({ ...ROW, dest_place_kind: 'unknown' } as unknown as Parameters<typeof mapRouteRow>[0])).toBeNull();
    });
  });
});
