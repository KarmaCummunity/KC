import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPaymentsRepository } from '@kc/application';
import type {
  DonationCheckoutResult,
  DonationHistoryRow,
  DonationReceiptDetail,
  NonprofitPublicPage,
  StandingOrderRow,
  VerifiedNonprofitRow,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { asObject, mapCheckout, mapNonprofitPage, mapReceipt, mapStandingOrder } from './paymentRows';

type Client = SupabaseClient<Database>;
type StandingOrderMove = 'cancel_standing_order' | 'pause_standing_order' | 'resume_standing_order';

const DEFAULT_PAGE = 50;

/**
 * The money world over the billing RPCs (supabase/schemas/85_billing/090, 130;
 * 80_organizations/040 for the nonprofit list). Amounts are integer agorot end to end. A refusal
 * is a `BackendRuleError` with the server's reason (`money_min_amount`, `verified_org_required`,
 * `payments_unavailable`, ...); a missing object is a `BackendUnavailableError`. The lists read the
 * first keyset page.
 */
export class SupabasePaymentsRepository implements IPaymentsRepository {
  constructor(private readonly client: Client) {}

  async listVerifiedNonprofits(limit = DEFAULT_PAGE): Promise<VerifiedNonprofitRow[]> {
    const rows = unwrapCall(
      'rpc:list_verified_nonprofits',
      await this.client.rpc('list_verified_nonprofits', { p_limit: limit }),
    );
    return (rows ?? []).map((row) => ({
      orgId: row.id,
      slug: row.slug,
      name: row.name,
      taglineHe: row.tagline_he,
      taglineEn: row.tagline_en,
      verificationLevel: row.verification_level,
    }));
  }

  async getNonprofitPublicPage(orgSlug: string): Promise<NonprofitPublicPage | null> {
    const page = asObject(unwrapCall(
      'rpc:get_nonprofit_public_page',
      await this.client.rpc('get_nonprofit_public_page', { p_org_slug: orgSlug }),
    ));
    return page ? mapNonprofitPage(page) : null;
  }

  async createDonationIntent(
    orgId: string,
    amountAgorot: number,
    idempotencyKey: string,
    postId?: string | null,
  ): Promise<DonationCheckoutResult> {
    const intent = asObject(unwrapCall(
      'rpc:create_donation_intent',
      await this.client.rpc('create_donation_intent', {
        p_org_id: orgId,
        p_amount_agorot: amountAgorot,
        p_idempotency_key: idempotencyKey,
        p_post_id: postId ?? undefined,
      }),
    ));
    if (!intent) throw new Error('create_donation_intent returned no intent');
    return mapCheckout(intent);
  }

  async createStandingOrder(orgId: string, amountAgorot: number, idempotencyKey: string): Promise<StandingOrderRow> {
    const order = asObject(unwrapCall(
      'rpc:create_standing_order',
      await this.client.rpc('create_standing_order', {
        p_org_id: orgId,
        p_amount_agorot: amountAgorot,
        p_idempotency_key: idempotencyKey,
        p_cadence: 'monthly',
      }),
    ));
    if (!order) throw new Error('create_standing_order returned no order');
    return mapStandingOrder(order);
  }

  async listMyStandingOrders(): Promise<StandingOrderRow[]> {
    const rows = unwrapCall('rpc:list_my_standing_orders', await this.client.rpc('list_my_standing_orders'));
    return (rows ?? []).flatMap((raw) => {
      const order = asObject(raw);
      return order ? [mapStandingOrder(order)] : [];
    });
  }

  cancelStandingOrder(orderId: string): Promise<void> {
    return this.moveStandingOrder('cancel_standing_order', orderId);
  }

  pauseStandingOrder(orderId: string): Promise<void> {
    return this.moveStandingOrder('pause_standing_order', orderId);
  }

  resumeStandingOrder(orderId: string): Promise<void> {
    return this.moveStandingOrder('resume_standing_order', orderId);
  }

  async listDonationHistory(limit = DEFAULT_PAGE): Promise<DonationHistoryRow[]> {
    const rows = unwrapCall(
      'rpc:list_my_donation_history',
      await this.client.rpc('list_my_donation_history', { p_limit: limit }),
    );
    return (rows ?? []).map((row) => ({
      paymentId: row.payment_id,
      orgId: row.org_id,
      orgName: row.org_name,
      amountAgorot: row.amount_agorot,
      refundedAgorot: row.refunded_agorot,
      currency: row.currency,
      status: row.status,
      paidAt: row.paid_at,
      standingOrderId: row.standing_order_id,
      receiptSerial: row.receipt_serial,
      sec46Eligible: row.sec46_eligible === true,
    }));
  }

  async getDonationReceipt(paymentId: string): Promise<DonationReceiptDetail | null> {
    const receipt = asObject(unwrapCall(
      'rpc:get_donation_receipt',
      await this.client.rpc('get_donation_receipt', { p_payment_id: paymentId }),
    ));
    return receipt ? mapReceipt(receipt) : null;
  }

  private async moveStandingOrder(rpc: StandingOrderMove, orderId: string): Promise<void> {
    unwrapCall(`rpc:${rpc}`, await this.client.rpc(rpc, { p_order_id: orderId }));
  }
}
