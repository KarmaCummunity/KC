import { describe, expect, it, vi } from 'vitest';
import type { IDonationLinksRepository } from '../../ports/IDonationLinksRepository';
import {
  DONATION_LINK_REVIEW_NOTE_MAX,
  ListDonationLinksForReviewUseCase,
  ReviewDonationLinkUseCase,
} from '../ReviewDonationLinksUseCases';
import { isDonationLinkError } from '../errors';

function repo(overrides: Partial<IDonationLinksRepository> = {}): IDonationLinksRepository {
  return {
    listByCategory: vi.fn(),
    addViaEdgeFunction: vi.fn(),
    updateViaEdgeFunction: vi.fn(),
    deleteById: vi.fn(),
    report: vi.fn(),
    listForReview: vi.fn(async () => []),
    review: vi.fn(async (_id: string, approve: boolean) => (approve ? 'approved' : 'rejected')),
    ...overrides,
  } as IDonationLinksRepository;
}

describe('ListDonationLinksForReviewUseCase', () => {
  it('asks for the pending queue by default and for another status when given', async () => {
    const r = repo();
    const uc = new ListDonationLinksForReviewUseCase(r);
    await uc.execute();
    await uc.execute('rejected');
    expect(r.listForReview).toHaveBeenNthCalledWith(1, 'pending');
    expect(r.listForReview).toHaveBeenNthCalledWith(2, 'rejected');
  });
});

describe('ReviewDonationLinkUseCase', () => {
  it('approves without a note, even when one is typed', async () => {
    const r = repo();
    await expect(new ReviewDonationLinkUseCase(r).execute({ linkId: 'l1', approve: true, note: 'x' })).resolves.toBe(
      'approved',
    );
    expect(r.review).toHaveBeenCalledWith('l1', true, null);
  });

  it('rejects with the trimmed note, and treats a blank note as none', async () => {
    const r = repo();
    const uc = new ReviewDonationLinkUseCase(r);
    await uc.execute({ linkId: 'l1', approve: false, note: '  not a registered org ' });
    await uc.execute({ linkId: 'l2', approve: false, note: '   ' });
    expect(r.review).toHaveBeenNthCalledWith(1, 'l1', false, 'not a registered org');
    expect(r.review).toHaveBeenNthCalledWith(2, 'l2', false, null);
  });

  it('refuses a missing id and an over-long note before calling the server', async () => {
    const r = repo();
    const uc = new ReviewDonationLinkUseCase(r);
    const tooLong = 'n'.repeat(DONATION_LINK_REVIEW_NOTE_MAX + 1);
    for (const input of [{ linkId: '', approve: true }, { linkId: 'l1', approve: false, note: tooLong }]) {
      const error = await uc.execute(input).catch((e: unknown) => e);
      expect(isDonationLinkError(error) && error.code).toBe('invalid_input');
    }
    expect(r.review).not.toHaveBeenCalled();
  });
});
