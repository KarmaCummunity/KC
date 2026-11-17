// FR-POST-021 — a new listing whose mask could not be saved is withdrawn, never left live unmasked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({ deleteMyListing: vi.fn() }));
vi.mock('../../../services/marketplaceComposition', () => ({ marketplaceRepository: () => repo }));

import { saveMaskOrWithdraw } from '../saveMaskOrWithdraw';

beforeEach(() => {
  repo.deleteMyListing.mockReset().mockResolvedValue(undefined);
});

describe('saveMaskOrWithdraw', () => {
  it('keeps the listing when the mask is saved', async () => {
    const saveMask = vi.fn().mockResolvedValue(undefined);
    await saveMaskOrWithdraw('p1', saveMask);
    expect(saveMask).toHaveBeenCalledWith('p1');
    expect(repo.deleteMyListing).not.toHaveBeenCalled();
  });

  it('withdraws the listing and reports the failure when the mask is not saved', async () => {
    const failure = new Error('network');
    await expect(saveMaskOrWithdraw('p1', vi.fn().mockRejectedValue(failure))).rejects.toBe(failure);
    expect(repo.deleteMyListing).toHaveBeenCalledWith('p1');
  });

  it('still reports the mask failure when the withdrawal fails too', async () => {
    const failure = new Error('network');
    repo.deleteMyListing.mockRejectedValue(new Error('offline'));
    await expect(saveMaskOrWithdraw('p1', vi.fn().mockRejectedValue(failure))).rejects.toBe(failure);
  });
});
