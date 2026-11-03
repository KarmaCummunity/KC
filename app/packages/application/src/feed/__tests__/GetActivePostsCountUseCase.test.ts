import { describe, it, expect } from 'vitest';
import { GetActivePostsCountUseCase } from '../GetActivePostsCountUseCase';
import type { IStatsRepository } from '../../ports/IStatsRepository';

function makeStats(value: number): IStatsRepository {
  const snap = {
    registeredUsers: 0,
    activePublicPosts: value,
    itemsDeliveredTotal: 0,
    asOf: null,
  };
  return {
    getActivePublicPostsCount: async () => value,
    getCommunityStatsSnapshot: async () => snap,
    listMyActivityTimeline: async () => [],
    getWorldFlowFunnel: async () => [],
    listMyWorldGivings: async () => [],
  };
}

describe('GetActivePostsCountUseCase', () => {
  it('returns the raw count from the repo when it is a positive integer', async () => {
    const uc = new GetActivePostsCountUseCase(makeStats(123));
    await expect(uc.execute()).resolves.toBe(123);
  });

  it('clamps negative counts to zero', async () => {
    const uc = new GetActivePostsCountUseCase(makeStats(-5));
    await expect(uc.execute()).resolves.toBe(0);
  });

  it('truncates fractional values rather than rounding', async () => {
    const uc = new GetActivePostsCountUseCase(makeStats(7.9));
    await expect(uc.execute()).resolves.toBe(7);
  });
});
