import { describe, expect, it } from 'vitest';
import { type AppliedEvent, receivePaymentEvent, signBody } from '../paymentProviderEvents';

const SECRET = 'sandbox-secret';
const EVENT = {
  provider_slug: 'sandbox',
  provider_event_id: 'evt_1',
  payload: { type: 'payment.succeeded', intent_id: 'i1', provider_ref: 'ref1', amount_agorot: 5000 },
};

function setup(over: { apply?: () => Promise<AppliedEvent>; secrets?: Record<string, string> } = {}) {
  const applied: Array<{ provider: string; eventId: string; payload: unknown }> = [];
  const reported: unknown[] = [];
  const secrets = over.secrets ?? { sandbox: SECRET };
  /** Delivers `body` with, unless `signature` is null, the signature of `secret` over that exact text. */
  const deliver = (body: unknown, options: { secret?: string; signature?: string | null } = {}) => {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const signature = options.signature === undefined ? signBody(rawBody, options.secret ?? SECRET) : options.signature;
    return receivePaymentEvent(
      { headers: new Headers(signature ? { 'x-kc-signature': signature } : {}), rawBody },
      {
        secretFor: (slug) => secrets[slug] ?? null,
        apply: (provider, eventId, payload) => {
          applied.push({ provider, eventId, payload });
          return over.apply ? over.apply() : Promise.resolve({ id: 'we-1', status: 'processed', errorCode: null });
        },
        report: (error) => reported.push(error),
      },
    );
  };
  return { deliver, applied, reported };
}

describe('receivePaymentEvent', () => {
  it('applies a correctly signed event once, with the provider and event id it carries', async () => {
    const { deliver, applied } = setup();

    expect(await deliver(EVENT)).toEqual({ status: 200, body: { ok: true, webhook_event_id: 'we-1' } });
    expect(applied).toEqual([{ provider: 'sandbox', eventId: 'evt_1', payload: EVENT.payload }]);
  });

  it('refuses a missing, wrong or foreign signature with 401 and applies nothing', async () => {
    const { deliver, applied } = setup();
    // A signature of another body does not cover this one.
    const ofAnotherBody = signBody(JSON.stringify({ ...EVENT, provider_event_id: 'evt_2' }), SECRET);

    for (const options of [{ signature: null }, { signature: 'sha256=00' }, { secret: 'another-secret' }, { signature: ofAnotherBody }]) {
      expect((await deliver(EVENT, options)).status).toBe(401);
    }
    expect(applied).toEqual([]);
  });

  it('fails closed for a provider without a configured secret', async () => {
    const { deliver, applied } = setup({ secrets: {} });

    expect((await deliver(EVENT)).status).toBe(401);
    expect((await deliver({ ...EVENT, provider_slug: 'unknown' })).status).toBe(401);
    expect(applied).toEqual([]);
  });

  it('refuses a body whose provider cannot be read with 401, and a signed but malformed event with 400, never inventing an id', async () => {
    const { deliver, applied } = setup();

    expect((await deliver('not json')).status).toBe(401);
    expect((await deliver({})).status).toBe(401);
    for (const bad of [{ ...EVENT, provider_event_id: '' }, { ...EVENT, payload: 'x' }, { ...EVENT, payload: [] }, { provider_slug: 'sandbox', payload: EVENT.payload }]) {
      expect(await deliver(bad)).toEqual({ status: 400, body: { ok: false, error: 'invalid_event' } });
    }
    expect(applied).toEqual([]);
  });

  it('reports a database failure and answers 500 without the cause, so the provider retries', async () => {
    const { deliver, reported } = setup({ apply: () => Promise.reject(new Error('connection reset')) });

    expect(await deliver(EVENT)).toEqual({ status: 500, body: { ok: false, error: 'internal' } });
    expect(reported).toHaveLength(1);
  });

  it('answers 422 for an event the database recorded as failed, so the provider resends it', async () => {
    const { deliver } = setup({ apply: () => Promise.resolve({ id: 'we-2', status: 'failed', errorCode: 'intent_not_found' }) });

    expect(await deliver(EVENT)).toEqual({ status: 422, body: { ok: false, error: 'event_failed', code: 'intent_not_found', webhook_event_id: 'we-2' } });
  });
});
