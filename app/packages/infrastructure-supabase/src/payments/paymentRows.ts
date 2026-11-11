// JSON → domain mappers of the money RPCs (supabase/schemas/85_billing/090_donor_rpcs.sql,
// 130_public_pages.sql). The RPCs answer `jsonb`; amounts arrive as JSON numbers in agorot.
import type {
  DonationCheckoutResult,
  DonationReceiptDetail,
  MoneyCampaignProgress,
  NonprofitPublicPage,
  StandingOrderRow,
} from '@kc/domain';
import type { Json } from '../database.types';

type JsonObject = { readonly [key: string]: Json | undefined };

/** The object a `jsonb` answer holds, or null for anything else. */
export function asObject(value: Json | undefined): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

const text = (o: JsonObject, key: string): string => (typeof o[key] === 'string' ? (o[key] as string) : '');
const textOrNull = (o: JsonObject, key: string): string | null => (typeof o[key] === 'string' ? (o[key] as string) : null);
/** bigint values may arrive as numeric strings. */
const num = (o: JsonObject, key: string): number => {
  const value = o[key];
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};

export function mapCheckout(o: JsonObject): DonationCheckoutResult {
  return {
    intentId: text(o, 'intent_id'),
    status: text(o, 'status'),
    checkoutUrl: textOrNull(o, 'checkout_url'),
    amountAgorot: num(o, 'amount_agorot'),
    currency: text(o, 'currency') || 'ILS',
    orgId: text(o, 'org_id'),
  };
}

export function mapStandingOrder(o: JsonObject): StandingOrderRow {
  return {
    orderId: text(o, 'order_id'),
    orgId: text(o, 'org_id'),
    orgName: textOrNull(o, 'org_name'),
    amountAgorot: num(o, 'amount_agorot'),
    currency: text(o, 'currency') || 'ILS',
    cadence: text(o, 'cadence'),
    status: text(o, 'status'),
    nextChargeAt: textOrNull(o, 'next_charge_at'),
    cancelledAt: textOrNull(o, 'cancelled_at'),
    createdAt: text(o, 'created_at'),
  };
}

function mapCampaign(o: JsonObject): MoneyCampaignProgress {
  return {
    postId: text(o, 'post_id'),
    title: text(o, 'title'),
    status: text(o, 'status'),
    publishedAt: textOrNull(o, 'published_at'),
    raisedAgorot: num(o, 'raised_agorot'),
  };
}

export function mapNonprofitPage(o: JsonObject): NonprofitPublicPage {
  const campaigns = Array.isArray(o['campaigns']) ? o['campaigns'] : [];
  return {
    orgId: text(o, 'org_id'),
    slug: text(o, 'slug'),
    name: text(o, 'name'),
    taglineHe: textOrNull(o, 'tagline_he'),
    taglineEn: textOrNull(o, 'tagline_en'),
    aboutHe: textOrNull(o, 'about_he'),
    aboutEn: textOrNull(o, 'about_en'),
    isVerifiedNonprofit: o['is_verified_nonprofit'] === true,
    verificationLevel: num(o, 'verification_level'),
    sec46Active: o['sec46_active'] === true,
    totalRaisedAgorot: num(o, 'total_raised_agorot'),
    campaigns: campaigns.flatMap((raw) => {
      const campaign = asObject(raw);
      return campaign ? [mapCampaign(campaign)] : [];
    }),
  };
}

export function mapReceipt(o: JsonObject): DonationReceiptDetail {
  return {
    receiptId: text(o, 'receipt_id'),
    serial: num(o, 'serial'),
    issuedAt: text(o, 'issued_at'),
    paymentId: text(o, 'payment_id'),
    amountAgorot: num(o, 'amount_agorot'),
    currency: text(o, 'currency') || 'ILS',
    sec46Eligible: o['sec46_eligible'] === true,
    sec46ApprovalNumber: textOrNull(o, 'sec46_approval_number'),
    orgId: text(o, 'org_id'),
    orgName: text(o, 'org_name'),
    orgSlug: text(o, 'org_slug'),
  };
}
