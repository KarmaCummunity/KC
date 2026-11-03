import { describe, expect, it, vi } from 'vitest';
import type { CreateRideSeriesInput } from '@kc/domain';
import { SupabaseRideSeriesRepository, mapRideSeriesRow } from '../SupabaseRideSeriesRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideSeriesRepository>[0];

const ROW = {
  series_id: 's1', direction: 'give', title: 'TLV → JLM', details: { seats_available: 3 },
  depart_time: '07:30:00', weekdays: 0b11111, duration_minutes: 75, ends_on: null, status: 'active',
};
const INPUT: CreateRideSeriesInput = {
  kindId: 'k1', direction: 'give', title: 'TLV → JLM', summary: 'daily', details: { seats_available: 3 },
  schedule: { weekdays: [0, 4], time: '07:30', endsOn: '2026-12-31' }, durationMinutes: 75,
};

/** A fake client: `from()` yields a builder chain resolving to `select`, `rpc()` resolves to `rpc`. */
function clientWith(select: { data?: unknown; error: { message: string } | null }, rpc: { data?: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'neq', 'order']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(select);
  const from = vi.fn(() => chain);
  const rpcFn = vi.fn().mockResolvedValue(rpc);
  return { from, chain, rpc: rpcFn, repo: new SupabaseRideSeriesRepository({ from, rpc: rpcFn } as unknown as AnyClient) };
}

describe('SupabaseRideSeriesRepository', () => {
  it('lists my series with their schedule, leaving cancelled ones out', async () => {
    const { from, chain, repo } = clientWith({ data: [ROW, { ...ROW, series_id: 's2', status: 'gone' }], error: null }, { error: null });
    await expect(repo.listMine()).resolves.toEqual([{
      id: 's1', direction: 'give', title: 'TLV → JLM', details: { seats_available: 3 },
      schedule: { weekdays: [0, 1, 2, 3, 4], time: '07:30', endsOn: null }, durationMinutes: 75, status: 'active',
    }]);
    expect(from).toHaveBeenCalledWith('ride_series');
    expect(chain.neq).toHaveBeenCalledWith('status', 'cancelled');
  });

  it('publishes a series through the RPC with the weekday mask and hands back the first ride', async () => {
    const { rpc, repo } = clientWith({ error: null }, { data: [{ series_id: 's1', first_listing_id: 'l1' }], error: null });
    await expect(repo.create(INPUT)).resolves.toEqual({ seriesId: 's1', firstListingId: 'l1' });
    expect(rpc).toHaveBeenCalledWith('create_ride_series', {
      p_kind_id: 'k1', p_title: 'TLV → JLM', p_details: { seats_available: 3 }, p_direction: 'give',
      p_depart_time: '07:30', p_weekdays: 0b10001, p_summary: 'daily', p_duration_minutes: 75, p_ends_on: '2026-12-31',
    });
  });

  it('throws when create_ride_series returns no row', async () => {
    const { repo } = clientWith({ error: null }, { data: [], error: null });
    await expect(repo.create(INPUT)).rejects.toThrow('create_ride_series returned no row');
  });

  it('throws when create_ride_series returns an error', async () => {
    const { repo } = clientWith({ error: null }, { data: null, error: { message: 'limit reached' } });
    await expect(repo.create(INPUT)).rejects.toThrow('limit reached');
  });

  it('changes the status and the schedule through their RPCs', async () => {
    const { rpc, repo } = clientWith({ error: null }, { error: null });
    await repo.setStatus('s1', 'paused');
    expect(rpc).toHaveBeenCalledWith('set_ride_series_status', { p_series_id: 's1', p_status: 'paused' });
    await repo.updateSchedule('s1', { weekdays: [2], time: '18:00', endsOn: null }, null);
    expect(rpc).toHaveBeenCalledWith('update_ride_series', {
      p_series_id: 's1', p_depart_time: '18:00', p_weekdays: 0b100, p_duration_minutes: undefined, p_ends_on: undefined,
    });
  });

  it('throws when updateSchedule returns an error', async () => {
    const { repo } = clientWith({ error: null }, { data: null, error: { message: 'update failed' } });
    await expect(
      repo.updateSchedule('s1', { weekdays: [2], time: '18:00', endsOn: null }, 60),
    ).rejects.toThrow('update failed');
  });

  it('lists the upcoming dates of a series', async () => {
    const { rpc, repo } = clientWith({ error: null }, {
      data: [{ listing_id: 'l2', departs_at: '2026-11-03T05:30:00Z', seats_left: 2, passengers: null }], error: null,
    });
    await expect(repo.listOccurrences('s1')).resolves.toEqual([
      { listingId: 'l2', departsAt: '2026-11-03T05:30:00Z', seatsLeft: 2, passengers: null },
    ]);
    expect(rpc).toHaveBeenCalledWith('list_ride_series_occurrences', { p_series_id: 's1' });
  });

  it('throws when listOccurrences returns an error', async () => {
    const { repo } = clientWith({ error: null }, { data: null, error: { message: 'not found' } });
    await expect(repo.listOccurrences('s1')).rejects.toThrow('not found');
  });

  it('surfaces server errors', async () => {
    const { repo } = clientWith({ data: null, error: { message: 'boom' } }, { data: null, error: { message: 'nope' } });
    await expect(repo.listMine()).rejects.toThrow('boom');
    await expect(repo.setStatus('s1', 'active')).rejects.toThrow('nope');
  });

  describe('mapRideSeriesRow edge cases', () => {
    it('maps request direction with null details', () => {
      const mapped = mapRideSeriesRow({
        ...ROW,
        direction: 'request',
        details: null,
      } as unknown as Parameters<typeof mapRideSeriesRow>[0]);

      expect(mapped).not.toBeNull();
      expect(mapped?.direction).toBe('request');
      expect(mapped?.details).toEqual({});
    });

    it('returns null for unknown direction', () => {
      expect(mapRideSeriesRow({ ...ROW, direction: 'other' } as unknown as Parameters<typeof mapRideSeriesRow>[0])).toBeNull();
    });
  });
});
