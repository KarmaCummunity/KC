import { describe, it, expect } from 'vitest';
import { GetCommunityStatsSnapshotUseCase } from '../GetCommunityStatsSnapshotUseCase';
import type { CommunityStatsSnapshot, IStatsRepository } from '../../ports/IStatsRepository';

function makeStats(s: Partial<CommunityStatsSnapshot> & { activePublicPosts: number }): IStatsRepository {
  const full: CommunityStatsSnapshot = {
    registeredUsers: s.registeredUsers ?? 0,
    activePublicPosts: s.activePublicPosts,
    itemsDeliveredTotal: s.itemsDeliveredTotal ?? 0,
    asOf: s.asOf ?? null,
  };
  return {
    getActivePublicPostsCount: async () => full.activePublicPosts,
    getCommunityStatsSnapshot: async () => full,
    listMyActivityTimeline: async () => [],
    getWorldFlowFunnel: async () => [],
    listMyWorldGivings: async () => [],
  };
}

describe('GetCommunityStatsSnapshotUseCase', () => {
  it('returns clamped non-negative integers for all fields', async () => {
    const uc = new GetCommunityStatsSnapshotUseCase(
      makeStats({ registeredUsers: 12.9, activePublicPosts: 3, itemsDeliveredTotal: -1 }),
    );
    await expect(uc.execute()).resolves.toEqual({
      registeredUsers: 12,
      activePublicPosts: 3,
      itemsDeliveredTotal: 0,
      asOf: null,
    });
  });

  it('handles non-finite values (NaN, Infinity) by defaulting to 0', async () => {
    const uc = new GetCommunityStatsSnapshotUseCase(
      makeStats({ registeredUsers: Number.NaN, activePublicPosts: Infinity, itemsDeliveredTotal: -Infinity }),
    );
    await expect(uc.execute()).resolves.toEqual({
      registeredUsers: 0,
      activePublicPosts: 0,
      itemsDeliveredTotal: 0,
      asOf: null,
    });
  });
});
