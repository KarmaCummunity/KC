import { describe, it, expect, vi } from 'vitest';
import type { IPaymentsRepository } from '../../ports/IPaymentsRepository';
import {
  CancelStandingOrderUseCase,
  CreateStandingOrderUseCase,
  DonateNowUseCase,
  GetDonationReceiptUseCase,
  GetNonprofitPublicPageUseCase,
  ListDonationHistoryUseCase,
  ListMyStandingOrdersUseCase,
  ListVerifiedNonprofitsUseCase,
  PauseStandingOrderUseCase,
  ResumeStandingOrderUseCase,
} from '../paymentUseCases';

function makeRepo() {
  return {
    listVerifiedNonprofits: vi.fn(async () => []),
    getNonprofitPublicPage: vi.fn(async () => null),
    createDonationIntent: vi.fn(async () => ({ intentId: 'i1' })),
    createStandingOrder: vi.fn(async () => ({ orderId: 'o1' })),
    listMyStandingOrders: vi.fn(async () => []),
    cancelStandingOrder: vi.fn(async () => undefined),
    pauseStandingOrder: vi.fn(async () => undefined),
    resumeStandingOrder: vi.fn(async () => undefined),
    listDonationHistory: vi.fn(async () => []),
    getDonationReceipt: vi.fn(async () => null),
  } as unknown as IPaymentsRepository & Record<string, ReturnType<typeof vi.fn>>;
}

describe('payment use cases', () => {
  it('delegate read use cases to the repository', async () => {
    const repo = makeRepo();
    await new ListVerifiedNonprofitsUseCase(repo).execute(5);
    await new GetNonprofitPublicPageUseCase(repo).execute('kc-org');
    await new ListMyStandingOrdersUseCase(repo).execute();
    await new ListDonationHistoryUseCase(repo).execute(7);
    await new GetDonationReceiptUseCase(repo).execute('p1');
    expect(repo.listVerifiedNonprofits).toHaveBeenCalledWith(5);
    expect(repo.getNonprofitPublicPage).toHaveBeenCalledWith('kc-org');
    expect(repo.listMyStandingOrders).toHaveBeenCalledWith();
    expect(repo.listDonationHistory).toHaveBeenCalledWith(7);
    expect(repo.getDonationReceipt).toHaveBeenCalledWith('p1');
  });

  it('delegate standing order lifecycle to the repository, in agorot', async () => {
    const repo = makeRepo();
    expect(
      await new CreateStandingOrderUseCase(repo).execute({ orgId: 'org', amountAgorot: 5000, idempotencyKey: 'k' }),
    ).toEqual({ orderId: 'o1' });
    await new CancelStandingOrderUseCase(repo).execute('o1');
    await new PauseStandingOrderUseCase(repo).execute('o1');
    await new ResumeStandingOrderUseCase(repo).execute('o1');
    expect(repo.createStandingOrder).toHaveBeenCalledWith('org', 5000, 'k');
    expect(repo.cancelStandingOrder).toHaveBeenCalledWith('o1');
    expect(repo.pauseStandingOrder).toHaveBeenCalledWith('o1');
    expect(repo.resumeStandingOrder).toHaveBeenCalledWith('o1');
  });

  it('starts a donation intent with the campaign post, or none', async () => {
    const repo = makeRepo();
    expect(await new DonateNowUseCase(repo).execute({ orgId: 'org', amountAgorot: 1800, idempotencyKey: 'k', postId: 'p1' }))
      .toEqual({ intentId: 'i1' });
    await new DonateNowUseCase(repo).execute({ orgId: 'org', amountAgorot: 1800, idempotencyKey: 'k2' });
    expect(repo.createDonationIntent).toHaveBeenNthCalledWith(1, 'org', 1800, 'k', 'p1');
    expect(repo.createDonationIntent).toHaveBeenNthCalledWith(2, 'org', 1800, 'k2', null);
  });
});
