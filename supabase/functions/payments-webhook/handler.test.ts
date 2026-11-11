import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createPaymentsWebhookHandler, signBody, type AppliedEvent } from './handler.ts';

const SECRET = 'sandbox-secret';
const EVENT = {
  provider_slug: 'sandbox',
  provider_event_id: 'evt_1',
  payload: { type: 'payment.succeeded', intent_id: 'i1', provider_ref: 'ref1', amount_agorot: 5000 },
};

/** A POST carrying `body` and, unless `signature` is null, the signature of `secret` over that exact text. */
async function post(body: unknown, opts: { secret?: string; signature?: string | null } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = opts.signature === undefined ? await signBody(text, opts.secret ?? SECRET) : opts.signature;
  return new Request('http://x/payments-webhook', {
    method: 'POST',
    headers: signature ? { 'x-kc-signature': signature } : {},
    body: text,
  });
}

function setup(over: { apply?: () => Promise<AppliedEvent>; secrets?: Record<string, string> } = {}) {
  const applied: { provider: string; eventId: string; payload: unknown }[] = [];
  const reported: unknown[] = [];
  const secrets = over.secrets ?? { sandbox: SECRET };
  const handler = createPaymentsWebhookHandler({
    secretFor: (slug) => secrets[slug] ?? null,
    apply: (provider, eventId, payload) => {
      applied.push({ provider, eventId, payload });
      return over.apply ? over.apply() : Promise.resolve({ id: 'we-1', status: 'processed', errorCode: null });
    },
    report: (e) => { reported.push(e); return Promise.resolve(); },
  });
  return { handler, applied, reported };
}

Deno.test('applies a correctly signed event once, with the provider and event id it carries', async () => {
  const { handler, applied } = setup();
  const res = await handler(await post(EVENT));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, webhook_event_id: 'we-1' });
  assertEquals(applied, [{ provider: 'sandbox', eventId: 'evt_1', payload: EVENT.payload }]);
});

Deno.test('rejects a wrong method before reading anything', async () => {
  const { handler, applied } = setup();
  assertEquals((await handler(new Request('http://x', { method: 'GET' }))).status, 405);
  assertEquals(applied, []);
});

Deno.test('rejects a missing, wrong or foreign signature with 401 and applies nothing', async () => {
  const { handler, applied } = setup();
  assertEquals((await handler(await post(EVENT, { signature: null }))).status, 401);
  assertEquals((await handler(await post(EVENT, { signature: 'sha256=00' }))).status, 401);
  assertEquals((await handler(await post(EVENT, { secret: 'another-secret' }))).status, 401);
  // A signature of another body does not cover this one.
  const other = await signBody(JSON.stringify({ ...EVENT, provider_event_id: 'evt_2' }), SECRET);
  assertEquals((await handler(await post(EVENT, { signature: other }))).status, 401);
  assertEquals(applied, []);
});

Deno.test('fails closed for a provider without a configured secret', async () => {
  const { handler, applied } = setup({ secrets: {} });
  assertEquals((await handler(await post(EVENT))).status, 401);
  assertEquals((await handler(await post({ ...EVENT, provider_slug: 'unknown' }))).status, 401);
  assertEquals(applied, []);
});

Deno.test('rejects a body without provider, event id or payload object with 400, never inventing an id', async () => {
  const { handler, applied } = setup();
  for (const bad of ['not json', {}, { ...EVENT, provider_event_id: '' }, { ...EVENT, payload: 'x' }, { ...EVENT, payload: [] }]) {
    const res = await handler(await post(bad));
    // Unsigned-by-secret garbage is 401 when the provider cannot be read, 400 once it is known.
    assertEquals([400, 401].includes(res.status), true);
  }
  const noId = await handler(await post({ provider_slug: 'sandbox', payload: EVENT.payload }));
  assertEquals(noId.status, 400);
  assertEquals(await noId.json(), { ok: false, error: 'invalid_event' });
  assertEquals(applied, []);
});

Deno.test('a database failure is reported and answered 500 without the cause, so the provider retries', async () => {
  const { handler, reported } = setup({ apply: () => Promise.reject(new Error('connection reset')) });
  const res = await handler(await post(EVENT));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'internal' });
  assertEquals(reported.length, 1);
});

Deno.test('an event the database recorded as failed is answered 422 so the provider resends it', async () => {
  const { handler } = setup({ apply: () => Promise.resolve({ id: 'we-2', status: 'failed', errorCode: 'intent_not_found' }) });
  const res = await handler(await post(EVENT));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { ok: false, error: 'event_failed', code: 'intent_not_found', webhook_event_id: 'we-2' });
});
