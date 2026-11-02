import { describe, expect, it, vi } from 'vitest';
import type { RideFeedItem } from '@kc/domain';
import type { IRidesFeedRepository } from '../../ports/IRidesFeedRepository';
import { ListRidesFeedUseCase } from '../ListRidesFeedUseCase';

const now = new Date(2026, 10, 1, 8, 0);
const RIDE: RideFeedItem = {
  listingId: 'l1', direction: 'request', title: 'Need a ride', departsAt: new Date(2026, 10, 1, 9, 0).toISOString(),
  originLabel: 'A', destLabel: 'B', meetingPoints: 0, seatsLeft: null, passengers: 1, recurrence: null, seriesMore: 0,
};

describe('ListRidesFeedUseCase', () => {
  it('loads the feed and groups it by day', async () => {
    const repo = { list: vi.fn<IRidesFeedRepository['list']>(async () => [RIDE]) } satisfies IRidesFeedRepository;
    await expect(new ListRidesFeedUseCase(repo).execute(now)).resolves.toEqual([{ group: 'today', items: [RIDE] }]);
    expect(repo.list).toHaveBeenCalledWith(100);
  });

  it('surfaces a failed load', async () => {
    const repo = { list: vi.fn<IRidesFeedRepository['list']>(async () => { throw new Error('offline'); }) };
    await expect(new ListRidesFeedUseCase(repo).execute(now)).rejects.toThrow('offline');
  });
});
