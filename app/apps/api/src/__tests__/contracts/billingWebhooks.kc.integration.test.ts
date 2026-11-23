import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IProEntitlementRepository } from '@kc/application';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBody } from '../../modules/billing/paymentProviderEvents';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const REVENUECAT_SECRET = 'rc-integration-secret';
const PAYMENTS_SECRET = 'payments-integration-secret';
const DAY_MS = 24 * 3600_000;

/**
 * The billing providers' webhook routes on the real KC schema: the request a
 * provider sends, the route's own check of who sent it, and the database
 * function that applies the event.
 */
describe.skipIf(!KC_DATABASE_URL)('Billing webhooks on the KC schema', () => {
  const database = new KcTestDatabase();
  let gateway: KcGateway;
  let baseUrl: string;

  const isPro = (userId: string) =>
    createRemotePort<IProEntitlementRepository>(createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(userId) }), 'proEntitlement').isPro();
  const revenueCat = (event: Record<string, unknown>, authorization = `Bearer ${REVENUECAT_SECRET}`) =>
    gateway.app.inject({ method: 'POST', url: '/v1/webhooks/revenuecat', payload: { event }, headers: { authorization } });
  /** Delivers a payment event as its provider does: the raw body, signed with the provider's secret. */
  const payments = (event: Record<string, unknown>, secret = PAYMENTS_SECRET) => {
    const raw = JSON.stringify(event);
    return gateway.app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments',
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-kc-signature': signBody(raw, secret) },
    });
  };
  const storedEvent = (eventId: string) =>
    database.admin.query<{ status: string; error_code: string | null }>(
      "select status, error_code from billing.webhook_events where provider_slug = 'sandbox' and provider_event_id = $1",
      [eventId],
    );

  beforeAll(async () => {
    gateway = await startKcGateway({
      config: {
        billing: {
          revenueCat: { webhookAuth: REVENUECAT_SECRET, proEntitlementId: 'pro', orgEntitlementId: 'org' },
          paymentWebhookSecrets: { sandbox: PAYMENTS_SECRET },
        },
      },
    });
    baseUrl = await gateway.listen();
  });

  afterAll(async () => {
    await database.admin.query("delete from billing.webhook_events where provider_slug = 'sandbox' and provider_event_id like 'evt-integration-%'");
    await gateway?.app.close();
    await database.close();
  });

  it('gives a member Pro on a store purchase and takes it back on expiration', async () => {
    const member = await database.newMember();
    const before = await isPro(member.userId);

    const purchase = await revenueCat({ type: 'INITIAL_PURCHASE', app_user_id: member.userId, entitlement_ids: ['pro'], expiration_at_ms: Date.now() + 30 * DAY_MS });
    const afterPurchase = await isPro(member.userId);
    const expiration = await revenueCat({ type: 'EXPIRATION', app_user_id: member.userId, entitlement_ids: ['pro'], expiration_at_ms: Date.now() - DAY_MS });
    const afterExpiration = await isPro(member.userId);

    expect([purchase.statusCode, expiration.statusCode]).toEqual([200, 200]);
    expect([before, afterPurchase, afterExpiration]).toEqual([false, true, false]);
  });

  it('refuses a store event without the shared secret; the member stays as they were', async () => {
    const member = await database.newMember();

    const forged = await revenueCat({ type: 'INITIAL_PURCHASE', app_user_id: member.userId, entitlement_ids: ['pro'] }, 'Bearer not-the-secret');

    expect(forged.statusCode).toBe(401);
    expect(await isPro(member.userId)).toBe(false);
  });

  it('stores a signed payment event and answers 422 when the database cannot apply it, so the provider resends', async () => {
    const eventId = `evt-integration-${randomUUID()}`;
    const event = { provider_slug: 'sandbox', provider_event_id: eventId, payload: { type: 'payment.succeeded', intent_id: randomUUID(), provider_ref: 'ref-1', amount_agorot: 5000 } };

    const first = await payments(event);
    const resent = await payments(event);
    const stored = await storedEvent(eventId);

    // No such donation intent exists: the event is kept, marked failed, and tried again on the resend.
    expect(first.statusCode).toBe(422);
    expect(first.json()).toMatchObject({ ok: false, error: 'event_failed', code: 'intent_not_found' });
    expect(resent.json().webhook_event_id).toBe(first.json().webhook_event_id);
    expect(stored.rows).toEqual([{ status: 'failed', error_code: 'intent_not_found' }]);
  });

  it('refuses a payment event signed with another secret, or naming a provider with no secret; nothing is stored', async () => {
    const eventId = `evt-integration-${randomUUID()}`;
    const event = { provider_slug: 'sandbox', provider_event_id: eventId, payload: { type: 'payment.succeeded', intent_id: randomUUID() } };

    const wrongSecret = await payments(event, 'not-the-secret');
    const unknownProvider = await payments({ ...event, provider_slug: 'constructor' });

    expect([wrongSecret.statusCode, unknownProvider.statusCode]).toEqual([401, 401]);
    expect((await storedEvent(eventId)).rows).toEqual([]);
  });
});
