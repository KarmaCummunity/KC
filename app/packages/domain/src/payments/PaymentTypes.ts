// Money world: donations to verified nonprofits and to KC, standing orders and receipts
// (docs/spec/requirements/13_donations.md FR-DONATE-011, 20_organizations.md FR-ORG-010,
// 19_org_finance.md FR-FIN-021). Every amount is integer agorot (1 ILS = 100 agorot), as the
// server keeps it; screens format it for display.

export interface VerifiedNonprofitRow {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly taglineHe: string | null;
  readonly taglineEn: string | null;
  /** Organization verification level, 1 (registered) to 5. */
  readonly verificationLevel: number;
}

/** A money-world campaign post of an organization and what it raised through the app. */
export interface MoneyCampaignProgress {
  readonly postId: string;
  readonly title: string;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly raisedAgorot: number;
  /** The campaign's goal; 0 when it set none (no progress bar then). */
  readonly goalAgorot: number;
  /** The campaign post's description; null when it has none. */
  readonly summary: string | null;
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
  readonly verificationLevel: number;
  /** A Section 46(a) approval is in force today. */
  readonly sec46Active: boolean;
  readonly totalRaisedAgorot: number;
  readonly campaigns: readonly MoneyCampaignProgress[];
}

/** A started one-time donation; the provider's page is `checkoutUrl` once the payment service set it. */
export interface DonationCheckoutResult {
  readonly intentId: string;
  readonly status: string;
  readonly checkoutUrl: string | null;
  readonly amountAgorot: number;
  readonly currency: string;
  readonly orgId: string;
}

/** `standing_orders.status` (0269); the moves between them are `standingOrderMachine`. */
export const STANDING_ORDER_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type StandingOrderStatus = (typeof STANDING_ORDER_STATUSES)[number];

export interface StandingOrderRow {
  readonly orderId: string;
  readonly orgId: string;
  readonly orgName: string | null;
  readonly amountAgorot: number;
  readonly currency: string;
  readonly cadence: string;
  readonly status: string;
  readonly nextChargeAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
}

/** One settled donation of the member, with its receipt when one was issued. */
export interface DonationHistoryRow {
  readonly paymentId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly amountAgorot: number;
  readonly refundedAgorot: number;
  readonly currency: string;
  readonly status: string;
  readonly paidAt: string;
  readonly standingOrderId: string | null;
  /** Receipt number of the organization; null until the receipt is issued. */
  readonly receiptSerial: number | null;
  readonly sec46Eligible: boolean;
}

export interface DonationReceiptDetail {
  readonly receiptId: string;
  readonly serial: number;
  readonly issuedAt: string;
  readonly paymentId: string;
  readonly amountAgorot: number;
  readonly currency: string;
  readonly sec46Eligible: boolean;
  readonly sec46ApprovalNumber: string | null;
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
}
