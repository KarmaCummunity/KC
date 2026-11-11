import type {
  DonationCheckoutResult,
  DonationHistoryRow,
  DonationReceiptDetail,
  NonprofitPublicPage,
  StandingOrderRow,
  VerifiedNonprofitRow,
} from '@kc/domain';

/**
 * Donations to organizations (FR-DONATE-011, FR-ORG-010, FR-FIN-021). Amounts are integer agorot.
 * A donation settles only when the payment provider confirms it to the server, so the app starts an
 * intent and sends the member to the provider's page; it never completes a payment itself.
 */
export interface IPaymentsRepository {
  /** The first page of verified nonprofits, by name. */
  listVerifiedNonprofits(limit?: number): Promise<VerifiedNonprofitRow[]>;
  getNonprofitPublicPage(orgSlug: string): Promise<NonprofitPublicPage | null>;
  /** Starts a one-time donation; repeating it with the same key returns the same intent. */
  createDonationIntent(
    orgId: string,
    amountAgorot: number,
    idempotencyKey: string,
    postId?: string | null,
  ): Promise<DonationCheckoutResult>;
  createStandingOrder(orgId: string, amountAgorot: number, idempotencyKey: string): Promise<StandingOrderRow>;
  listMyStandingOrders(): Promise<StandingOrderRow[]>;
  cancelStandingOrder(orderId: string): Promise<void>;
  pauseStandingOrder(orderId: string): Promise<void>;
  resumeStandingOrder(orderId: string): Promise<void>;
  /** The first page of the member's settled donations, newest first. */
  listDonationHistory(limit?: number): Promise<DonationHistoryRow[]>;
  getDonationReceipt(paymentId: string): Promise<DonationReceiptDetail | null>;
}
