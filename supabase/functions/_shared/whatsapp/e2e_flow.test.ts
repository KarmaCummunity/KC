// End-to-end WhatsApp bot flow (#940) — signed webhook → intake-ish RPCs →
// match notify → outbound queue → sender with mocked Graph API. No secrets.
import { assertEquals, assertExists } from 'jsr:@std/assert@1';
import { createWebhookHandler, hmacSha256Hex } from '../../whatsapp-webhook/handler.ts';
import { createSenderHandler } from '../../whatsapp-sender/handler.ts';
import { runSenderBatch, type RpcFn } from './sender.ts';
import type { OutboundMessage, SendResult } from './meta.ts';

const SECRET = 'e2e-test-app-secret';
const WA = '972500009999';

type OutRow = {
  outbound_id: string;
  kind: 'template' | 'session';
  to_wa_id: string | null;
  language: string | null;
  template_name: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  user_id: string;
};

type State = {
  allowed: boolean;
  consentOptedIn: boolean;
  phoneOptedOut: boolean;
  records: string[];
  outbound: OutRow[];
  keywordCalls: string[];
  graphBodies: unknown[];
};

function freshState(): State {
  return {
    allowed: true,
    consentOptedIn: false,
    phoneOptedOut: false,
    records: [],
    outbound: [],
    keywordCalls: [],
    graphBodies: [],
  };
}

function makeRpc(state: State): RpcFn {
  const claimed = new Set<string>();
  return (fn, args) => {
    if (fn === 'api_whatsapp_claim_inbound') {
      // #1089 dedupe: first delivery of a wamid wins.
      const id = String(args.p_message_id);
      const fresh = !claimed.has(id);
      claimed.add(id);
      return Promise.resolve({ data: fresh, error: null });
    }
    if (fn === 'api_whatsapp_inbound_allowed') {
      return Promise.resolve({ data: state.allowed, error: null });
    }
    if (fn === 'api_whatsapp_ingest_inbound') {
      const id = `rec-${state.records.length + 1}`;
      state.records.push(id);
      return Promise.resolve({ data: id, error: null });
    }
    if (fn === 'api_whatsapp_handle_keyword') {
      const text = String(args.p_text ?? '').trim().toLowerCase();
      state.keywordCalls.push(text);
      let action: string | null = null;
      if (['stop', 'הסר', 'עצור'].includes(text)) {
        action = 'opt_out';
        state.consentOptedIn = false;
        state.phoneOptedOut = true;
      } else if (['start', 'הצטרף'].includes(text)) {
        action = 'opt_in';
        state.consentOptedIn = true;
        state.phoneOptedOut = false;
      } else if (['help', 'עזרה'].includes(text)) {
        action = 'help';
      }
      return Promise.resolve({
        data: action ? { action, language: 'he' } : { action: null },
        error: null,
      });
    }
    if (fn === 'api_whatsapp_queue_reply') {
      const id = crypto.randomUUID();
      state.outbound.push({
        outbound_id: id,
        kind: 'session',
        to_wa_id: String(args.p_wa_id ?? WA),
        language: 'he',
        template_name: null,
        body: String(args.p_body ?? ''),
        payload: { reply_kind: args.p_reply_kind },
        status: 'queued',
        user_id: 'u-e2e',
      });
      return Promise.resolve({ data: id, error: null });
    }
    if (fn === 'api_whatsapp_queue_outbound') {
      const can = state.consentOptedIn && !state.phoneOptedOut;
      const id = crypto.randomUUID();
      state.outbound.push({
        outbound_id: id,
        kind: 'template',
        to_wa_id: WA,
        language: 'he',
        template_name: String(args.p_template_name ?? 'match_found_v1'),
        body: null,
        payload: (args.p_payload as Record<string, unknown>) ?? {},
        status: can ? 'queued' : 'skipped_no_consent',
        user_id: String(args.p_user_id ?? 'u-e2e'),
      });
      return Promise.resolve({ data: id, error: null });
    }
    if (fn === 'api_whatsapp_outbound_claim') {
      const batch = Number(args.p_batch ?? 20);
      const due = state.outbound.filter((o) => o.status === 'queued').slice(0, batch);
      for (const o of due) o.status = 'sending';
      return Promise.resolve({ data: due, error: null });
    }
    if (fn === 'api_whatsapp_outbound_result') {
      const row = state.outbound.find((o) => o.outbound_id === args.p_outbound_id);
      if (!row) return Promise.resolve({ data: 'failed', error: null });
      if (args.p_ok) {
        row.status = 'sent';
        return Promise.resolve({ data: 'sent', error: null });
      }
      if (args.p_retryable) {
        row.status = 'queued';
        return Promise.resolve({ data: 'queued', error: null });
      }
      row.status = 'failed';
      return Promise.resolve({ data: 'failed', error: null });
    }
    if (fn === 'api_whatsapp_bot_access') {
      // #1086: e2e phone is not linked; upsell rate-limited away.
      return Promise.resolve({ data: { access: 'unlinked', user_id: null, upsell: false }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
  };
}

function metaBody(text: string, id = 'wamid.e2e1') {
  return JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'pnid-1' },
      messages: [{ id, from: WA, type: 'text', text: { body: text } }],
    } }] }],
  });
}

async function signedPost(
  handler: (r: Request) => Promise<Response>,
  body: string,
) {
  const headers = {
    'Content-Type': 'application/json',
    'x-hub-signature-256': `sha256=${await hmacSha256Hex(SECRET, body)}`,
  };
  return handler(new Request('https://x/functions/v1/whatsapp-webhook', {
    method: 'POST', body, headers,
  }));
}

/** Simulate intake → publish → match notify (DB side) after a free-text ingest. */
function simulateMatchNotify(rpc: RpcFn) {
  // Two sides get match_found_v1 once consent allows it.
  return Promise.all([
    rpc('api_whatsapp_queue_outbound', {
      p_user_id: 'u-a', p_template_name: 'match_found_v1',
      p_payload: { world_label: 'Items', world_label_he: 'Items', world_label_en: 'Items' },
    }),
    rpc('api_whatsapp_queue_outbound', {
      p_user_id: 'u-b', p_template_name: 'match_found_v1',
      p_payload: { world_label: 'Items', world_label_he: 'Items', world_label_en: 'Items' },
    }),
  ]);
}

Deno.test('e2e: signed free-text → ingest; START → consent; match → outbound; sender mocks Meta', async () => {
  const state = freshState();
  const rpc = makeRpc(state);
  const webhook = createWebhookHandler({
    rpc, verifyToken: 'v', appSecret: SECRET, skipSignatureVerify: false,
  });

  // 1) Free text listing intent (no keyword)
  const r1 = await signedPost(webhook, metaBody('I can give a sofa in Tel Aviv', 'wamid.t1'));
  assertEquals(r1.status, 200);
  assertEquals(state.records.length, 1);

  // 2) Without consent, match notify is skipped
  await simulateMatchNotify(rpc);
  assertEquals(state.outbound.filter((o) => o.kind === 'template' && o.status === 'queued').length, 0);
  assertEquals(state.outbound.filter((o) => o.status === 'skipped_no_consent').length, 2);

  // 3) START keyword → opt in + session confirmation reply
  const r2 = await signedPost(webhook, metaBody('START', 'wamid.t2'));
  assertEquals(r2.status, 200);
  assertEquals(state.consentOptedIn, true);
  assertEquals(state.outbound.some((o) => o.kind === 'session'), true);

  // 4) Match notify now queues templates
  state.outbound = state.outbound.filter((o) => o.kind === 'session'); // clear skips
  await simulateMatchNotify(rpc);
  const queued = state.outbound.filter((o) => o.kind === 'template' && o.status === 'queued');
  assertEquals(queued.length, 2);

  // 5) Sender drains queue via mocked Graph (no real Meta)
  const fetchFn = (input: string, init?: RequestInit) => {
    state.graphBodies.push(JSON.parse(String(init?.body ?? '{}')));
    assertEquals(input.includes('/messages'), true);
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 }));
  };
  const sender = createSenderHandler({
    serviceKey: 'service-role-key-for-tests',
    rpc,
    loadChannelConfig: () => Promise.resolve({
      is_enabled: true, phone_number_id: 'pnid-1', graph_api_version: 'v21.0',
    }),
    token: 'test-token-not-a-secret',
    phoneNumberId: 'pnid-1',
    graphVersion: 'v21.0',
    fetchFn,
  });
  const sendRes = await sender(new Request('https://x/functions/v1/whatsapp-sender', {
    method: 'POST',
    headers: { Authorization: 'Bearer service-role-key-for-tests' },
    body: JSON.stringify({ batch: 10 }),
  }));
  assertEquals(sendRes.status, 200);
  const summary = await sendRes.json();
  assertEquals(summary.ok, true);
  const sentTemplates = state.outbound.filter((o) => o.kind === 'template' && o.status === 'sent');
  assertEquals(sentTemplates.length, 2);
  assertEquals(state.graphBodies.length >= 2, true);
  assertEquals(summary.sent >= 2, true);
});

Deno.test('e2e: STOP after opt-in blocks further proactive templates; confirmation still queues', async () => {
  const state = freshState();
  state.consentOptedIn = true;
  const rpc = makeRpc(state);
  const webhook = createWebhookHandler({
    rpc, verifyToken: 'v', appSecret: SECRET, skipSignatureVerify: false,
  });

  const stop = await signedPost(webhook, metaBody('הסר', 'wamid.stop'));
  assertEquals(stop.status, 200);
  assertEquals(state.phoneOptedOut, true);
  assertEquals(state.consentOptedIn, false);
  assertExists(state.outbound.find((o) => o.kind === 'session'));

  await simulateMatchNotify(rpc);
  assertEquals(state.outbound.filter((o) => o.kind === 'template' && o.status === 'queued').length, 0);
  assertEquals(state.outbound.filter((o) => o.status === 'skipped_no_consent').length, 2);
});

Deno.test('e2e: wrong signature never touches RPCs', async () => {
  const state = freshState();
  const rpc = makeRpc(state);
  const webhook = createWebhookHandler({
    rpc, verifyToken: 'v', appSecret: SECRET, skipSignatureVerify: false,
  });
  const body = metaBody('hi');
  const res = await webhook(new Request('https://x/', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
  }));
  assertEquals(res.status, 401);
  assertEquals(state.records.length, 0);
});

Deno.test('e2e: runSenderBatch with injectable send (no network)', async () => {
  const state = freshState();
  state.consentOptedIn = true;
  const rpc = makeRpc(state);
  await rpc('api_whatsapp_queue_outbound', {
    p_user_id: 'u', p_template_name: 'match_found_v1',
    p_payload: { world_label: 'Food', params: ['Food'] },
  });
  const sent: OutboundMessage[] = [];
  const summary = await runSenderBatch({
    rpc,
    send: (m): Promise<SendResult> => {
      sent.push(m);
      return Promise.resolve({ ok: true, waMessageId: 'wamid.x' });
    },
  });
  assertEquals(summary.sent, 1);
  assertEquals(sent[0]?.kind, 'template');
});
