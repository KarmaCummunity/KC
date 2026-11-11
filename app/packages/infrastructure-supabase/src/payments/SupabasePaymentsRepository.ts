import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPaymentsRepository } from '@kc/application';
import type {
  DonationHistoryRow,
  DonationReceiptDetail,
  MoneyCampaignProgress,
  NonprofitPublicPage,
  StandingOrderRow,
  VerifiedNonprofitRow,
} from '@kc/domain';
import type { Database } from '../database.legacy.types';

type NonprofitRow = Database['public']['Functions']['list_verified_nonprofits']['Returns'][number];

function mapNonprofit(row: NonprofitRow): VerifiedNonprofitRow {
  return {
    orgId: row.org_id,
    slug: row.slug,
    name: row.name,
    taglineHe: row.tagline_he,
    taglineEn: row.tagline_en,
    isVerifiedNonprofit: row.is_verified_nonprofit,
  };
}

function mapStanding(row: Database['public']['Tables']['standing_orders']['Row']): StandingOrderRow {
  return {
    orderId: row.order_id,
    orgId: row.org_id,
    amountIls: Number(row.amount_ils),
    cadence: row.cadence,
    status: row.status,
    nextChargeAt: row.next_charge_at,
    createdAt: row.created_at,
  };
}

export class SupabasePaymentsRepository implements IPaymentsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listVerifiedNonprofits(limit = 50): Promise<VerifiedNonprofitRow[]> {
    const { data, error } = await this.client.rpc('list_verified_nonprofits', { p_limit: limit });
    if (error || !data) return [];
    return data.map(mapNonprofit);
  }

  async getNonprofitPublicPage(orgSlug: string): Promise<NonprofitPublicPage | null> {
    const { data, error } = await this.client.rpc('get_nonprofit_public_page', { p_org_slug: orgSlug });
    if (error || data == null || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    const campaignsRaw = o.campaigns;
    const campaigns: MoneyCampaignProgress[] = [];
    if (Array.isArray(campaignsRaw)) {
      for (const raw of campaignsRaw) {
        if (!raw || typeof raw !== 'object') continue;
        const c = raw as Record<string, unknown>;
        campaigns.push({
          listingId: String(c.listing_id),
          title: String(c.title),
          summary: c.summary != null ? String(c.summary) : null,
          status: String(c.status),
          publishedAt: c.published_at != null ? String(c.published_at) : null,
          goalIls: Number(c.goal_ils ?? 0),
          raisedIls: Number(c.raised_ils ?? 0),
        });
      }
    }
    return {
      orgId: String(o.org_id),
      slug: String(o.slug),
      name: String(o.name),
      taglineHe: o.tagline_he != null ? String(o.tagline_he) : null,
      taglineEn: o.tagline_en != null ? String(o.tagline_en) : null,
      aboutHe: o.about_he != null ? String(o.about_he) : null,
      aboutEn: o.about_en != null ? String(o.about_en) : null,
      isVerifiedNonprofit: Boolean(o.is_verified_nonprofit),
      totalRaisedIls: Number(o.total_raised_ils ?? 0),
      campaigns,
    };
  }

  async createDonationIntent(
    orgId: string,
    amountIls: number,
    idempotencyKey: string,
    listingId?: string | null,
  ) {
    const { data, error } = await this.client.rpc('create_donation_intent', {
      p_org_id: orgId,
      p_amount_ils: amountIls,
      p_idempotency_key: idempotencyKey,
      p_listing_id: listingId ?? undefined,
    });
    if (error || !data) throw error ?? new Error('create_donation_intent failed');
    const row = data as Database['public']['Tables']['donation_intents']['Row'];
    return {
      intentId: row.intent_id,
      checkoutUrl: row.checkout_url,
      orgId: row.org_id,
      amountIls: Number(row.amount_ils),
    };
  }

  async completeSandboxDonation(intentId: string) {
    const { data, error } = await this.client.rpc('complete_sandbox_donation', {
      p_intent_id: intentId,
    });
    if (error || !data || typeof data !== 'object') {
      throw error ?? new Error('complete_sandbox_donation failed');
    }
    const o = data as Record<string, unknown>;
    return {
      paymentId: String(o.payment_id),
      receiptId: o.receipt_id != null ? String(o.receipt_id) : null,
      section46Serial: o.section46_serial != null ? String(o.section46_serial) : null,
    };
  }

  async createStandingOrder(orgId: string, amountIls: number, idempotencyKey: string) {
    const { data, error } = await this.client.rpc('create_standing_order', {
      p_org_id: orgId,
      p_amount_ils: amountIls,
      p_idempotency_key: idempotencyKey,
      p_cadence: 'monthly',
    });
    if (error || !data) throw error ?? new Error('create_standing_order failed');
    return mapStanding(data);
  }

  async listMyStandingOrders(limit = 50) {
    const { data, error } = await this.client.rpc('list_my_standing_orders', { p_limit: limit });
    if (error || !data) return [];
    return data.map(mapStanding);
  }

  async cancelStandingOrder(orderId: string) {
    const { error } = await this.client.rpc('cancel_standing_order', { p_order_id: orderId });
    if (error) throw error;
  }

  async pauseStandingOrder(orderId: string) {
    const { error } = await this.client.rpc('pause_standing_order', { p_order_id: orderId });
    if (error) throw error;
  }

  async resumeStandingOrder(orderId: string) {
    const { error } = await this.client.rpc('resume_standing_order', { p_order_id: orderId });
    if (error) throw error;
  }

  async listDonationHistory(limit = 50) {
    const { data, error } = await this.client.rpc('list_my_donation_history', { p_limit: limit });
    if (error || !data) return [];
    return data.map(
      (r): DonationHistoryRow => ({
        paymentId: r.payment_id,
        orgId: r.org_id,
        orgName: r.org_name,
        amountIls: Number(r.amount_ils),
        paidAt: r.paid_at,
        receiptId: r.receipt_id,
        section46Serial: r.section46_serial,
      }),
    );
  }

  async getDonationReceipt(paymentId: string): Promise<DonationReceiptDetail | null> {
    const { data, error } = await this.client.rpc('get_donation_receipt', {
      p_payment_id: paymentId,
    });
    if (error || data == null || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    return {
      receiptId: o.receipt_id != null ? String(o.receipt_id) : null,
      section46Serial: o.section46_serial != null ? String(o.section46_serial) : null,
      issuedAt: o.issued_at != null ? String(o.issued_at) : null,
      paymentId: String(o.payment_id),
      amountIls: Number(o.amount_ils),
      paidAt: String(o.paid_at),
      orgId: String(o.org_id),
      orgName: String(o.org_name),
      orgSlug: String(o.org_slug),
      sandbox: Boolean(o.sandbox),
    };
  }
}
