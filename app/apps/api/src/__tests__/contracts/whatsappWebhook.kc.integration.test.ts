import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const URL = '/v1/webhooks/whatsapp';
const VERIFY_TOKEN = 'integration-verify-token';
const APP_SECRET = 'integration-app-secret';

/**
 * The WhatsApp inbound webhook on the real KC schema (#843, #937, #1089): a
 * delivery the provider signed is stored once, a consent keyword is answered,
 * and nothing is accepted without the provider's credential.
 */
describe('WhatsApp inbound webhook on the KC schema', () => {
  const database = new KcTestDatabase();
  let gateway: KcGateway;
  /** A phone number no other run uses, so throttles and consent start clean. */
  const waId = `9725${String(Date.now()).slice(-8)}`;

  const deliveryOf = (text: string, messageId = `wamid.${randomUUID()}`) =>
    JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn-test' }, messages: [{ id: messageId, from: waId, type: 'text', text: { body: text } }] } }] }] });
  /** Delivers a body the way the provider does: raw, with its signature under the app secret. */
  const deliver = async (raw: string, secret = APP_SECRET) => {
    const response = await gateway.app.inject({
      method: 'POST',
      url: URL,
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` },
    });
    // A refusal is plain text in the provider's protocol; everything else is JSON.
    const isJson = String(response.headers['content-type']).includes('application/json');
    return { status: response.statusCode, body: (isJson ? response.json() : {}) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    gateway = await startKcGateway({ config: { whatsapp: { cloudApiToken: null, phoneNumberId: null, graphApiVersion: null, verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET } } });
  });

  afterAll(async () => {
    await gateway.app.close();
    await database.close();
  });

  it('answers the provider\'s registration check with its challenge, and only for the right token', async () => {
    const query = (token: string) => `${URL}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`;

    const accepted = await gateway.app.inject({ method: 'GET', url: query(VERIFY_TOKEN) });
    const refused = await gateway.app.inject({ method: 'GET', url: query('a-guess') });

    expect([accepted.statusCode, accepted.body]).toEqual([200, '1158201444']);
    expect(refused.statusCode).toBe(403);
  });

  it('stores a signed message once: the provider\'s retry of the same delivery adds nothing', async () => {
    const raw = deliveryOf('hello from the integration test');

    const first = await deliver(raw);
    const retry = await deliver(raw);

    expect(first.status).toBe(200);
    expect(first.body.record_ids).toHaveLength(1);
    expect(retry.body).toMatchObject({ ok: true, record_ids: [], results: [{ duplicate: true }] });
  });

  it('answers a consent keyword with a queued confirmation', async () => {
    const { status, body } = await deliver(deliveryOf('STOP'));

    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ keyword: 'opt_out' });
    expect(body.results[0].reply_id).toEqual(expect.any(String));
  });

  it('accepts nothing that the provider did not sign', async () => {
    const raw = deliveryOf('forged');

    expect((await deliver(raw, 'another-secret')).status).toBe(401);
    const unsigned = await gateway.app.inject({ method: 'POST', url: URL, payload: raw, headers: { 'content-type': 'application/json' } });
    expect(unsigned.statusCode).toBe(401);
  });
});
