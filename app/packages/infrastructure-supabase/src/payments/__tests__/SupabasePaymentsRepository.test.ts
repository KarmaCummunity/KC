// FR-DONATE-011, FR-ORG-010, FR-FIN-021 — the money adapter against the billing RPCs, in agorot.
import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabasePaymentsRepository } from '../SupabasePaymentsRepository';

const ORDER = {
  order_id: 'o1', org_id: 'org', org_name: 'Aid', amount_agorot: 3600, currency: 'ILS', cadence: 'monthly',
  status: 'pending', next_charge_at: null, cancelled_at: null, created_at: '2030-01-01T00:00:00Z',
};

const repoOf = (config: Parameters<typeof createFakeClient>[0]) => {
  const fake = createFakeClient(config);
  return { ...fake, repo: new SupabasePaymentsRepository(fake.client) };
};

describe('SupabasePaymentsRepository — organizations', () => {
  it('lists verified nonprofits from the first keyset page', async () => {
    const { repo, calls } = repoOf({ rpc: { list_verified_nonprofits: ok([
      { id: 'org', slug: 'aid', name: 'Aid', tagline_he: null, tagline_en: 'Help', verification_level: 2 },
    ]) } });
    expect(await repo.listVerifiedNonprofits(20)).toEqual([
      { orgId: 'org', slug: 'aid', name: 'Aid', taglineHe: null, taglineEn: 'Help', verificationLevel: 2 },
    ]);
    expect(callsTo(calls, 'list_verified_nonprofits')[0]?.args).toEqual({ p_limit: 20 });
  });

  it('maps the public page of a nonprofit with its campaigns, and null for an unknown one', async () => {
    const page = {
      org_id: 'org', slug: 'aid', name: 'Aid', tagline_he: null, tagline_en: null, about_he: 'a', about_en: null,
      is_verified_nonprofit: true, verification_level: 3, sec46_active: true, total_raised_agorot: 125000,
      campaigns: [{
        post_id: 'p1', title: 'Coats', status: 'open', published_at: '2030-01-01T00:00:00Z', raised_agorot: '5000',
        goal_agorot: 250000, summary: 'For 40 families',
      }],
    };
    const { repo } = repoOf({ rpc: { get_nonprofit_public_page: ok(page) } });
    expect(await repo.getNonprofitPublicPage('aid')).toMatchObject({
      totalRaisedAgorot: 125000, sec46Active: true, verificationLevel: 3,
      campaigns: [{ postId: 'p1', title: 'Coats', raisedAgorot: 5000, goalAgorot: 250000, summary: 'For 40 families' }],
    });
    const unknown = repoOf({ rpc: { get_nonprofit_public_page: ok(null) } });
    expect(await unknown.repo.getNonprofitPublicPage('x')).toBeNull();
  });
});

describe('SupabasePaymentsRepository — donations', () => {
  it('starts a donation intent in agorot with the campaign post', async () => {
    const intent = { intent_id: 'i1', status: 'created', org_id: 'org', amount_agorot: 1800, currency: 'ILS', checkout_url: null };
    const { repo, calls } = repoOf({ rpc: { create_donation_intent: ok(intent) } });
    expect(await repo.createDonationIntent('org', 1800, 'k1', 'p1')).toEqual({
      intentId: 'i1', status: 'created', checkoutUrl: null, amountAgorot: 1800, currency: 'ILS', orgId: 'org',
    });
    expect(callsTo(calls, 'create_donation_intent')[0]?.args).toEqual({
      p_org_id: 'org', p_amount_agorot: 1800, p_idempotency_key: 'k1', p_post_id: 'p1',
    });
  });

  it('keeps the server reason of a refused donation and reports a missing function', async () => {
    const refused = repoOf({ rpc: { create_donation_intent: fail('P0001', 'money_min_amount') } });
    await expect(refused.repo.createDonationIntent('org', 1, 'k')).rejects.toBeInstanceOf(BackendRuleError);
    await expect(refused.repo.createDonationIntent('org', 1, 'k')).rejects.toThrow('money_min_amount');
    const missing = repoOf({ rpc: { list_my_donation_history: fail('PGRST202', 'nope') } });
    await expect(missing.repo.listDonationHistory()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('maps the donation history and a receipt', async () => {
    const { repo } = repoOf({ rpc: {
      list_my_donation_history: ok([{
        payment_id: 'pay', org_id: 'org', org_name: 'Aid', amount_agorot: 1800, refunded_agorot: 0, currency: 'ILS',
        status: 'succeeded', paid_at: '2030-01-02T00:00:00Z', standing_order_id: null, receipt_serial: 7, sec46_eligible: true,
      }]),
      get_donation_receipt: ok({
        receipt_id: 'r1', serial: 7, issued_at: '2030-01-02T00:00:00Z', payment_id: 'pay', amount_agorot: 1800, currency: 'ILS',
        sec46_eligible: true, sec46_approval_number: '123', org_id: 'org', org_name: 'Aid', org_slug: 'aid',
      }),
    } });
    expect((await repo.listDonationHistory())[0]).toMatchObject({ amountAgorot: 1800, receiptSerial: 7, sec46Eligible: true });
    expect(await repo.getDonationReceipt('pay')).toMatchObject({ serial: 7, amountAgorot: 1800, sec46ApprovalNumber: '123' });
  });
});

describe('SupabasePaymentsRepository — standing orders', () => {
  it('creates a monthly order and lists the member orders', async () => {
    const { repo, calls } = repoOf({ rpc: { create_standing_order: ok(ORDER), list_my_standing_orders: ok([ORDER, 'junk']) } });
    expect(await repo.createStandingOrder('org', 3600, 'k')).toMatchObject({ orderId: 'o1', amountAgorot: 3600, orgName: 'Aid' });
    expect(callsTo(calls, 'create_standing_order')[0]?.args).toEqual({
      p_org_id: 'org', p_amount_agorot: 3600, p_idempotency_key: 'k', p_cadence: 'monthly',
    });
    expect(await repo.listMyStandingOrders()).toHaveLength(1);
  });

  it('moves an order with its RPC and keeps the server reason', async () => {
    const { repo, calls } = repoOf({ rpc: { resume_standing_order: fail('P0001', 'order_not_found') } });
    await repo.pauseStandingOrder('o1');
    await repo.cancelStandingOrder('o1');
    await expect(repo.resumeStandingOrder('o1')).rejects.toThrow('order_not_found');
    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ['pause_standing_order', { p_order_id: 'o1' }], ['cancel_standing_order', { p_order_id: 'o1' }],
      ['resume_standing_order', { p_order_id: 'o1' }],
    ]);
  });
});
