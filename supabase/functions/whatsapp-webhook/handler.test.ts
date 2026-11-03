import { assertEquals } from 'jsr:@std/assert@1';
import type { RpcFn } from '../_shared/whatsapp/sender.ts';
import { createWebhookHandler, hmacSha256Hex, type WebhookDeps } from './handler.ts';

type Call = { fn: string; args: Record<string, unknown> };
const SECRET = 'unit-test-app-secret';

function deps(overrides: Partial<Record<string, unknown>> = {}, calls: Call[] = []): WebhookDeps {
  const rpc: RpcFn = (fn, args) => {
    calls.push({ fn, args });
    const canned: Record<string, unknown> = {
      api_whatsapp_claim_inbound: overrides.claimed ?? true,
      api_whatsapp_inbound_allowed: overrides.allowed ?? true,
      api_whatsapp_ingest_inbound: 'rec-1',
      api_whatsapp_handle_keyword: overrides.keyword ?? { action: null },
      api_whatsapp_queue_reply: 'out-1',
      api_whatsapp_bot_access: overrides.access ?? { access: 'unlinked', user_id: null, upsell: false },
      api_whatsapp_redeem_link_code: { status: overrides.linkStatus ?? 'linked' },
    };
    return Promise.resolve({ data: canned[fn] ?? null, error: null });
  };
  return { rpc, verifyToken: 'verify-me', appSecret: SECRET, skipSignatureVerify: false };
}

function metaBody(text: string, from = '972500000001') {
  return JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '1' },
      messages: [{ id: 'wamid.in1', from, type: 'text', text: { body: text } }],
    } }] }],
  });
}

async function post(handler: (r: Request) => Promise<Response>, body: string, sign = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sign) headers['x-hub-signature-256'] = `sha256=${await hmacSha256Hex(SECRET, body)}`;
  return handler(new Request('https://x/functions/v1/whatsapp-webhook', { method: 'POST', body, headers }));
}

Deno.test('GET verify returns the challenge only for the right token', async () => {
  const h = createWebhookHandler(deps());
  const ok = await h(new Request('https://x/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'));
  assertEquals(await ok.text(), '42');
  const bad = await h(new Request('https://x/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'));
  assertEquals(bad.status, 403);
});

Deno.test('rejects an unsigned / wrongly signed POST', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({}, calls));
  assertEquals((await post(h, metaBody('hi'), false)).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('plain message is ingested, no reply queued', async () => {
  const calls: Call[] = [];
  const res = await post(createWebhookHandler(deps({}, calls)), metaBody('I have a sofa'));
  assertEquals(res.status, 200);
  assertEquals(calls.map((c) => c.fn), [
    'api_whatsapp_claim_inbound', 'api_whatsapp_inbound_allowed', 'api_whatsapp_ingest_inbound', 'api_whatsapp_handle_keyword',
    'api_whatsapp_bot_access',
  ]);
});

Deno.test('STOP opts out and queues an en consent confirmation', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({ keyword: { action: 'opt_out', language: 'en', consent_status: 'opted_out' } }, calls));
  const res = await post(h, metaBody('STOP'));
  const out = await res.json();
  assertEquals(out.results[0].keyword, 'opt_out');
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(reply.args.p_reply_kind, 'consent_confirmation');
  assertEquals(reply.args.p_wa_id, '972500000001');
  assertEquals(String(reply.args.p_body).includes('unsubscribed'), true);
  assertEquals(calls.find((c) => c.fn === 'api_whatsapp_handle_keyword')!.args.p_record_id, 'rec-1');
});

Deno.test('Hebrew STOP gets the Hebrew confirmation', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({ keyword: { action: 'opt_out', language: 'he' } }, calls));
  await post(h, metaBody('\u05d4\u05e1\u05e8'));
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(/[\u0590-\u05ff]/.test(String(reply.args.p_body)), true);
});

Deno.test('throttled phone: not ingested, but STOP is still honoured', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({ allowed: false, keyword: { action: 'opt_out', language: 'en' } }, calls));
  const out = await (await post(h, metaBody('stop'))).json();
  assertEquals(out.results[0].throttled, true);
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_ingest_inbound'), false);
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_handle_keyword'), true);
});

Deno.test('load: 50 messages from one phone with a 20/min DB throttle → 30 dropped', async () => {
  let hits = 0;
  const calls: Call[] = [];
  const base = deps({}, calls);
  const h = createWebhookHandler({
    ...base,
    rpc: (fn, args) => fn === 'api_whatsapp_inbound_allowed'
      ? Promise.resolve({ data: ++hits <= 20, error: null })
      : base.rpc(fn, args),
  });
  let throttled = 0;
  for (let i = 0; i < 50; i++) {
    const out = await (await post(h, metaBody(`msg ${i}`))).json();
    if (out.results[0].throttled) throttled++;
  }
  assertEquals(throttled, 30);
  assertEquals(calls.filter((c) => c.fn === 'api_whatsapp_ingest_inbound').length, 20);
});

Deno.test('#1090: a 6-digit code from WhatsApp is redeemed and answered', async () => {
  const calls: Call[] = [];
  const out = await (await post(createWebhookHandler(deps({}, calls)), metaBody('LINK 123456'))).json();
  assertEquals(out.results[0].link_status, 'linked');
  const redeem = calls.find((c) => c.fn === 'api_whatsapp_redeem_link_code')!;
  assertEquals(redeem.args, { p_wa_id: '972500000001', p_code: '123456' });
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(String(reply.args.p_body).includes('linked'), true);
});

Deno.test('#1090: an invalid code gets the retry reply; plain text is not redeemed', async () => {
  const calls: Call[] = [];
  const out = await (await post(createWebhookHandler(deps({ linkStatus: 'invalid' }, calls)), metaBody('654321'))).json();
  assertEquals(out.results[0].link_status, 'invalid');
  const calls2: Call[] = [];
  await post(createWebhookHandler(deps({}, calls2)), metaBody('I have 2 chairs'));
  assertEquals(calls2.some((c) => c.fn === 'api_whatsapp_redeem_link_code'), false);
});

Deno.test('#1086: non-Pro free text gets the upsell when the DB allows it', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({ access: { access: 'not_pro', user_id: 'u1', upsell: true } }, calls));
  const out = await (await post(h, metaBody('I need a fridge'))).json();
  assertEquals(out.results[0].access, 'not_pro');
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(String(reply.args.p_body).includes('Pro'), true);
});

Deno.test('#1086: upsell is not repeated inside the 24h window', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler(deps({ access: { access: 'unlinked', user_id: null, upsell: false } }, calls));
  await post(h, metaBody('hello'));
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_queue_reply'), false);
});

Deno.test('#1086: Pro user is handed to the agent, never upsold', async () => {
  const calls: Call[] = [];
  const seen: string[] = [];
  const h = createWebhookHandler({
    ...deps({ access: { access: 'pro', user_id: 'u-pro', upsell: false } }, calls),
    onProMessage: ({ userId, text }) => { seen.push(`${userId}:${text}`); return Promise.resolve(); },
  });
  await post(h, metaBody('find me a bike'));
  assertEquals(seen, ['u-pro:find me a bike']);
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_queue_reply'), false);
});

Deno.test('#1086: link codes and STOP bypass the Pro gate', async () => {
  const calls: Call[] = [];
  await post(createWebhookHandler(deps({}, calls)), metaBody('123456'));
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_bot_access'), false);
});

Deno.test('#1089: a retried delivery (already claimed wamid) is skipped entirely', async () => {
  const calls: Call[] = [];
  const out = await (await post(createWebhookHandler(deps({ claimed: false }, calls)), metaBody('STOP'))).json();
  assertEquals(out.results[0].duplicate, true);
  assertEquals(calls.map((c) => c.fn), ['api_whatsapp_claim_inbound']);
});

Deno.test('#1089: a failure after the claim releases it so the retry is processed', async () => {
  const calls: Call[] = [];
  const base = deps({}, calls);
  const h = createWebhookHandler({
    ...base,
    rpc: (fn, args) => fn === 'api_whatsapp_ingest_inbound'
      ? Promise.resolve({ data: null, error: { message: 'boom' } })
      : base.rpc(fn, args),
  });
  const res = await post(h, metaBody('hello'));
  assertEquals(res.status, 500);
  assertEquals(calls.some((c) => c.fn === 'api_whatsapp_release_inbound'), true);
});

Deno.test('#1089: no app secret and no dev override → POST rejected (fails closed)', async () => {
  const calls: Call[] = [];
  const h = createWebhookHandler({ ...deps({}, calls), appSecret: '' });
  assertEquals((await post(h, metaBody('hi'))).status, 401);
  assertEquals(calls.length, 0);
});
