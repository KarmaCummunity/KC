export interface VerifiedNonprofitRow {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly taglineHe: string | null;
  readonly taglineEn: string | null;
  readonly isVerifiedNonprofit: boolean;
}

export interface MoneyCampaignProgress {
  readonly listingId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly goalIls: number;
  readonly raisedIls: number;
}

export interface NonprofitPublicPage {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly taglineHe: string | null;
  readonly taglineEn: string | null;
  readonly aboutHe: string | null;
  readonly aboutEn: string | null;
  readonly isVerifiedNonprofit: boolean;
  readonly totalRaisedIls: number;
  readonly campaigns: readonly MoneyCampaignProgress[];
}

export interface DonationCheckoutResult {
  readonly intentId: string;
  readonly checkoutUrl: string | null;
  readonly amountIls: number;
  readonly orgId: string;
  readonly providerSlug: string;
}

export interface CompletedDonation {
  readonly paymentId: string;
  readonly receiptId: string | null;
  readonly section46Serial: string | null;
  readonly status: 'paid';
}

/** `standing_orders.status` (0269); the moves between them are `standingOrderMachine`. */
export const STANDING_ORDER_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type StandingOrderStatus = (typeof STANDING_ORDER_STATUSES)[number];

export interface StandingOrderRow {
  readonly orderId: string;
  readonly orgId: string;
  readonly amountIls: number;
  readonly cadence: string;
  readonly status: string;
  readonly nextChargeAt: string | null;
  readonly createdAt: string;
}

export interface DonationHistoryRow {
  readonly paymentId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly amountIls: number;
  readonly paidAt: string;
  readonly receiptId: string | null;
  readonly section46Serial: string | null;
}

export interface DonationReceiptDetail {
  readonly receiptId: string | null;
  readonly section46Serial: string | null;
  readonly issuedAt: string | null;
  readonly paymentId: string;
  readonly amountIls: number;
  readonly paidAt: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly sandbox: boolean;
}
