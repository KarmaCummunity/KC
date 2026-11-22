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
  // FR-STATS-003 AC1: the timeline shows up to the 30 most recent entries.
  it('clamps a larger limit to 30 before delegating to the repository', async () => {
    const stats = makeStats();
    const uc = new ListMyActivityTimelineUseCase(stats);
    await uc.execute(999);
    expect(stats.listMyActivityTimeline).toHaveBeenCalledWith(30);
  });

  it('clamps a zero or fractional limit to at least one whole entry', async () => {
    const stats = makeStats();
    const uc = new ListMyActivityTimelineUseCase(stats);
    await uc.execute(0);
    await uc.execute(7.9);
    expect(stats.listMyActivityTimeline).toHaveBeenNthCalledWith(1, 1);
    expect(stats.listMyActivityTimeline).toHaveBeenNthCalledWith(2, 7);
  });

  it('defaults to 30', async () => {
    const stats = makeStats();
    const uc = new ListMyActivityTimelineUseCase(stats);
    await uc.execute();
    expect(stats.listMyActivityTimeline).toHaveBeenCalledWith(30);
  });
});
