import { describe, it, expect, vi } from 'vitest';
import type { IMarketplaceRepository } from '../../ports/IMarketplaceRepository';
import { GivingHandoffError } from '@kc/domain';
import {
  CancelGivingHandoffUseCase,
  ClaimFoodGivingUseCase,
  ConfirmItemHandoffUseCase,
  GetListingHandoffUseCase,
  ListMyGivingHandoffsUseCase,
  MarkGivingHandedOverUseCase,
  RateGivingHandoffUseCase,
  ReserveItemGivingUseCase,
} from '../givingHandoffUseCases';

const snap = { handoffId: 'h1' };

function makeRepo() {
  return {
    getListingHandoff: vi.fn(async () => null),
    listMyGivingHandoffs: vi.fn(async () => []),
    reserveItemGiving: vi.fn(async () => snap),
    confirmItemHandoff: vi.fn(async () => snap),
    claimFoodGiving: vi.fn(async () => snap),
    cancelGivingHandoff: vi.fn(async () => undefined),
    markGivingHandedOver: vi.fn(async () => snap),
    rateGivingHandoff: vi.fn(async () => undefined),
  };
}

describe('giving handoff use cases', () => {
  it('delegate to the marketplace repository on valid input', async () => {
    const repo = makeRepo();
    const r = repo as unknown as IMarketplaceRepository;
    expect(await new GetListingHandoffUseCase(r).execute('l1')).toBeNull();
    expect(repo.getListingHandoff).toHaveBeenCalledWith('l1');
    expect(await new ListMyGivingHandoffsUseCase(r).execute(5)).toEqual([]);
    expect(repo.listMyGivingHandoffs).toHaveBeenCalledWith(5);
    expect(await new ReserveItemGivingUseCase(r).execute('l1', 'delivery', 'a', 'b')).toBe(snap);
    expect(repo.reserveItemGiving).toHaveBeenCalledWith('l1', 'delivery', 'a', 'b');
    expect(await new ConfirmItemHandoffUseCase(r).execute('h1')).toBe(snap);
    expect(await new ClaimFoodGivingUseCase(r).execute('l1', 'a', null)).toBe(snap);
    expect(repo.claimFoodGiving).toHaveBeenCalledWith('l1', 'a', null);
    await new CancelGivingHandoffUseCase(r).execute('h1');
    expect(repo.cancelGivingHandoff).toHaveBeenCalledWith('h1');
    expect(await new MarkGivingHandedOverUseCase(r).execute('h1')).toBe(snap);
    await new RateGivingHandoffUseCase(r).execute('h1', 5, 'great');
    expect(repo.rateGivingHandoff).toHaveBeenCalledWith('h1', 5, 'great');
  });

  describe('ReserveItemGivingUseCase validation', () => {
    it('throws listing_not_available if listingId is empty', async () => {
      const repo = makeRepo();
      const uc = new ReserveItemGivingUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('')).rejects.toThrowError(GivingHandoffError);
      await expect(uc.execute('   ')).rejects.toMatchObject({ code: 'listing_not_available' });
    });

    it('throws invalid_pickup_mode if pickupMode is not pickup or delivery', async () => {
      const repo = makeRepo();
      const uc = new ReserveItemGivingUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('l1', 'express' as never)).rejects.toMatchObject({ code: 'invalid_pickup_mode' });
    });
  });

  describe('ConfirmItemHandoffUseCase (select recipient) validation', () => {
    it('throws handoff_not_found if handoffId is empty', async () => {
      const repo = makeRepo();
      const uc = new ConfirmItemHandoffUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('')).rejects.toMatchObject({ code: 'handoff_not_found' });
    });
  });

  describe('MarkGivingHandedOverUseCase (complete) validation', () => {
    it('throws handoff_not_found if handoffId is empty', async () => {
      const repo = makeRepo();
      const uc = new MarkGivingHandedOverUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('')).rejects.toMatchObject({ code: 'handoff_not_found' });
    });
  });

  describe('RateGivingHandoffUseCase (feedback) validation', () => {
    it('throws handoff_not_found if handoffId is empty', async () => {
      const repo = makeRepo();
      const uc = new RateGivingHandoffUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('', 5)).rejects.toMatchObject({ code: 'handoff_not_found' });
    });

    it('throws invalid_rating if rating is not an integer between 1 and 5', async () => {
      const repo = makeRepo();
      const uc = new RateGivingHandoffUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('h1', 0)).rejects.toMatchObject({ code: 'invalid_rating' });
      await expect(uc.execute('h1', 6)).rejects.toMatchObject({ code: 'invalid_rating' });
      await expect(uc.execute('h1', 4.5)).rejects.toMatchObject({ code: 'invalid_rating' });
    });

    it('throws comment_too_long if comment exceeds 300 characters', async () => {
      const repo = makeRepo();
      const uc = new RateGivingHandoffUseCase(repo as unknown as IMarketplaceRepository);
      await expect(uc.execute('h1', 5, 'x'.repeat(301))).rejects.toMatchObject({ code: 'comment_too_long' });
    });
  });
});
