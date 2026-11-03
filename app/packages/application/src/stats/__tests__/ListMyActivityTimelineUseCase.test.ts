import { describe, it, expect, vi } from 'vitest';
import { ListMyActivityTimelineUseCase } from '../ListMyActivityTimelineUseCase';
import type { IStatsRepository } from '../../ports/IStatsRepository';

function makeStats(): IStatsRepository {
  return {
    getActivePublicPostsCount: async () => 0,
    getCommunityStatsSnapshot: async () => ({
      registeredUsers: 0,
      activePublicPosts: 0,
      itemsDeliveredTotal: 0,
      asOf: null,
    }),
    listMyActivityTimeline: vi.fn(async () => []),
    getWorldFlowFunnel: async () => [],
    listMyWorldGivings: async () => [],
  };
}

describe('ListMyActivityTimelineUseCase', () => {
  it('clamps limit to 1..50 before delegating to the repository', async () => {
    const stats = makeStats();
    const uc = new ListMyActivityTimelineUseCase(stats);
    await uc.execute(999);
    expect(stats.listMyActivityTimeline).toHaveBeenCalledWith(50);
  });

  it('defaults to 30', async () => {
    const stats = makeStats();
    const uc = new ListMyActivityTimelineUseCase(stats);
    await uc.execute();
    expect(stats.listMyActivityTimeline).toHaveBeenCalledWith(30);
  });
});
