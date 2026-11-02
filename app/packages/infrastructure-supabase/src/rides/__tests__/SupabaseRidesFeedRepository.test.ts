import { describe, expect, it, vi } from 'vitest';
import { SupabaseRidesFeedRepository } from '../SupabaseRidesFeedRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRidesFeedRepository>[0];

const ROW = {
  listing_id: 'l1', direction: 'give', title: 'TLV to JLM', departs_at: '2026-11-01T08:00:00Z',
  origin_label: 'Tel Aviv', dest_label: 'Jerusalem', meeting_points: 1, seats_left: 2, passengers: null, recurrence: null, series_more: 0,
};

function repoWith(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, repo: new SupabaseRidesFeedRepository({ rpc, from: vi.fn() } as unknown as AnyClient) };
}

describe('SupabaseRidesFeedRepository', () => {
  it('maps the feed rows', async () => {
    const { rpc, repo } = repoWith({ data: [ROW], error: null });
    await expect(repo.list(100)).resolves.toEqual([{
      listingId: 'l1', direction: 'give', title: 'TLV to JLM', departsAt: '2026-11-01T08:00:00Z',
      originLabel: 'Tel Aviv', destLabel: 'Jerusalem', meetingPoints: 1, seatsLeft: 2, passengers: null, recurrence: null, seriesMore: 0,
    }]);
    expect(rpc).toHaveBeenCalledWith('list_rides_feed', { p_limit: 100 });
  });

  it('reads the recurrence of a recurring ride occurrence (FR-RIDE-046)', async () => {
    const recurrence = { id: 's1', on: '2026-11-01', weekdays: 0b11111, time: '08:00' };
    const { repo } = repoWith({ data: [{ ...ROW, recurrence, series_more: 27 }], error: null });
    const [item] = await repo.list(10);
    expect(item?.recurrence).toEqual({ id: 's1', on: '2026-11-01', weekdays: [0, 1, 2, 3, 4], time: '08:00' });
    expect(item?.seriesMore).toBe(27);
  });

  it('drops rows of an unknown direction', async () => {
    const { repo } = repoWith({ data: [{ ...ROW, direction: 'swap' }], error: null });
    await expect(repo.list(10)).resolves.toEqual([]);
  });

  it('throws the server error', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'boom' } });
    await expect(repo.list(10)).rejects.toThrow('boom');
  });
});
