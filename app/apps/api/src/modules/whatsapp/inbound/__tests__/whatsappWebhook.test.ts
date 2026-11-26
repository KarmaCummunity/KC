import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WebhookRequest } from '../../../../platform/webhooks/webhookRequest';
import { receiveDelivery, verifySubscription, type WhatsAppWebhookDeps } from '../whatsappWebhook';

const APP_SECRET = 'app-secret';
const signatureOf = (body: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const webhookOf = (rawBody: string, signature: string | null): WebhookRequest => ({ rawBody, headers: { get: (name) => (name === 'x-hub-signature-256' ? signature : null) } });
const DELIVERY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '972500000001', type: 'text', text: { body: 'hello' } }] } }] }] });

/** The webhook with a database that accepts everything, and a record of what it was asked. */
function setup(over: Partial<WhatsAppWebhookDeps> = {}) {
  const asked: string[] = [];
  const reported: unknown[] = [];
  const deps: WhatsAppWebhookDeps = {
    verifyToken: 'verify-token',
    appSecret: APP_SECRET,
    rpc: (fn) => {
      asked.push(fn);
      return Promise.resolve({ data: fn === 'api_whatsapp_ingest_inbound' ? 'record-1' : fn === 'api_whatsapp_claim_inbound' || fn === 'api_whatsapp_inbound_allowed' ? true : {}, error: null });
    },
    report: (error) => reported.push(error),
    ...over,
  };
  return { deps, asked, reported };
}

describe('verifySubscription', () => {
  const query = (over: Record<string, unknown> = {}) => ({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token', 'hub.challenge': '1158201444', ...over });

  it('answers the provider\'s challenge when it sends the token it was given', () => {
    expect(verifySubscription(query(), 'verify-token')).toEqual({ status: 200, body: '1158201444' });
  });

  it.each([
    ['a wrong token', query({ 'hub.verify_token': 'guess' }), 'verify-token'],
    ['another mode', query({ 'hub.mode': 'unsubscribe' }), 'verify-token'],
    ['no challenge', query({ 'hub.challenge': '' }), 'verify-token'],
    ['a token that is not text', query({ 'hub.verify_token': ['verify-token'] }), 'verify-token'],
    ['no token configured', query({ 'hub.verify_token': '' }), null],
  ])('refuses %s', (_case, parameters, verifyToken) => {
    expect(verifySubscription(parameters, verifyToken)).toEqual({ status: 403, body: 'forbidden' });
  });
});

describe('receiveDelivery', () => {
  it('handles a delivery signed with the app secret', async () => {
    const { deps, asked } = setup();

    const answer = await receiveDelivery(webhookOf(DELIVERY, signatureOf(DELIVERY)), deps);

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, record_ids: ['record-1'] });
    expect(asked[0]).toBe('api_whatsapp_claim_inbound');
  });

  it.each([
    ['no signature', null],
    ['a signature under another secret', signatureOf(DELIVERY, 'other-secret')],
    ['a signature of another body', signatureOf(`${DELIVERY} `)],
    ['a signature without its prefix', signatureOf(DELIVERY).slice('sha256='.length)],
  ])('refuses a delivery with %s before anything is read', async (_case, signature) => {
    const { deps, asked } = setup();

    expect(await receiveDelivery(webhookOf(DELIVERY, signature), deps)).toEqual({ status: 401, body: 'invalid signature' });
    expect(asked).toEqual([]);
  });

  it('refuses every delivery when no app secret is configured', async () => {
    const { deps, asked } = setup({ appSecret: null });

    expect((await receiveDelivery(webhookOf(DELIVERY, signatureOf(DELIVERY, '')), deps)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('answers 400 for a signed body that is not JSON, and 200 for one with no messages', async () => {
    const { deps } = setup();

    expect((await receiveDelivery(webhookOf('not json', signatureOf('not json')), deps)).status).toBe(400);
    expect(await receiveDelivery(webhookOf('{}', signatureOf('{}')), deps)).toEqual({ status: 200, body: { ok: true, record_ids: [], results: [] } });
  });

  it('answers 500 without the cause when a message cannot be handled, and reports it', async () => {
    const failure = { message: 'connection to 10.0.0.5 refused' };
    const { deps, reported } = setup({ rpc: () => Promise.resolve({ data: null, error: failure }) });

    const answer = await receiveDelivery(webhookOf(DELIVERY, signatureOf(DELIVERY)), deps);

    expect(answer).toEqual({ status: 500, body: { ok: false, error: 'delivery_failed' } });
    expect(String(reported[0])).toContain('10.0.0.5');
  });
});
