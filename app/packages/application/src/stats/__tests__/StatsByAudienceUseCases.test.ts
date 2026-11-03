import { describe, expect, it, vi } from 'vitest';
import type { IStatsRepository } from '../../ports/IStatsRepository';
import { GetWorldFlowFunnelUseCase, ListMyWorldGivingsUseCase } from '../StatsByAudienceUseCases';

function repo(): IStatsRepository {
  return {
    getActivePublicPostsCount: vi.fn(),
    getCommunityStatsSnapshot: vi.fn(),
    listMyActivityTimeline: vi.fn(),
    getWorldFlowFunnel: vi.fn(async () => []),
    listMyWorldGivings: vi.fn(async () => [
      { worldSlug: 'items', worldLabelHe: 'חפצים', worldLabelEn: 'Items', given: 2, received: 1, closed: 1 },
    ]),
  } as IStatsRepository;
}

describe('GetWorldFlowFunnelUseCase', () => {
  it('passes a whole-day window inside 1..365', async () => {
    const r = repo();
    const uc = new GetWorldFlowFunnelUseCase(r);
    await uc.execute(30);
    await uc.execute(7.4);
    expect(r.getWorldFlowFunnel).toHaveBeenNthCalledWith(1, 30);
    expect(r.getWorldFlowFunnel).toHaveBeenNthCalledWith(2, 7);
  });

  it('clamps an out-of-range or invalid window instead of failing', async () => {
    const r = repo();
    const uc = new GetWorldFlowFunnelUseCase(r);
    await uc.execute(0);
    await uc.execute(10_000);
    await uc.execute(Number.NaN);
    expect(r.getWorldFlowFunnel).toHaveBeenNthCalledWith(1, 1);
    expect(r.getWorldFlowFunnel).toHaveBeenNthCalledWith(2, 365);
    expect(r.getWorldFlowFunnel).toHaveBeenNthCalledWith(3, 30);
  });
});

describe('ListMyWorldGivingsUseCase', () => {
  it('returns the member’s own rows from the repository', async () => {
    const rows = await new ListMyWorldGivingsUseCase(repo()).execute();
    expect(rows).toEqual([
      { worldSlug: 'items', worldLabelHe: 'חפצים', worldLabelEn: 'Items', given: 2, received: 1, closed: 1 },
    ]);
  });
});
