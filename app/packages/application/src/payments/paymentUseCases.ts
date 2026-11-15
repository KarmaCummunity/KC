// Money world use cases (FR-DONATE-011, FR-ORG-010, FR-FIN-021). Amounts are integer agorot.
import type { IPaymentsRepository } from '../ports/IPaymentsRepository';
import type {
  DonationCheckoutResult,
  DonationHistoryRow,
  DonationReceiptDetail,
  NonprofitPublicPage,
  StandingOrderRow,
  VerifiedNonprofitRow,
} from '@kc/domain';

export class ListVerifiedNonprofitsUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(limit?: number): Promise<VerifiedNonprofitRow[]> {
    return this.repo.listVerifiedNonprofits(limit);
  }
}

export class GetNonprofitPublicPageUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(orgSlug: string): Promise<NonprofitPublicPage | null> {
    return this.repo.getNonprofitPublicPage(orgSlug);
  }
}

/** Starts a one-time donation; the provider's page settles it (the app never completes a payment). */
export class DonateNowUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(input: {
    orgId: string;
    amountAgorot: number;
    idempotencyKey: string;
    postId?: string | null;
  }): Promise<DonationCheckoutResult> {
    return this.repo.createDonationIntent(input.orgId, input.amountAgorot, input.idempotencyKey, input.postId ?? null);
  }
}

export class CreateStandingOrderUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(input: { orgId: string; amountAgorot: number; idempotencyKey: string }): Promise<StandingOrderRow> {
    return this.repo.createStandingOrder(input.orgId, input.amountAgorot, input.idempotencyKey);
  }
}

export class ListMyStandingOrdersUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(): Promise<StandingOrderRow[]> {
    return this.repo.listMyStandingOrders();
  }
}

export class CancelStandingOrderUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  async execute(orderId: string): Promise<void> {
    await this.repo.cancelStandingOrder(orderId);
  }
}

export class PauseStandingOrderUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  async execute(orderId: string): Promise<void> {
    await this.repo.pauseStandingOrder(orderId);
  }
}

export class ResumeStandingOrderUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  async execute(orderId: string): Promise<void> {
    await this.repo.resumeStandingOrder(orderId);
  }
}

export class ListDonationHistoryUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(limit?: number): Promise<DonationHistoryRow[]> {
    return this.repo.listDonationHistory(limit);
  }
}

export class GetDonationReceiptUseCase {
  constructor(private readonly repo: IPaymentsRepository) {}
  execute(paymentId: string): Promise<DonationReceiptDetail | null> {
    return this.repo.getDonationReceipt(paymentId);
  }
}
