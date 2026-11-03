// whatsapp-webhook request handler — #843 (verify + signature + ingest),
// #937 (STOP/START/HELP keywords → consent + confirmation reply),
// #938 (per-phone inbound throttle). Dependencies are injected so it is unit-testable.

import { detectLang, isKeywordAction, keywordReply, replyKind, upsellReply } from '../_shared/whatsapp/replies.ts';
import { isLinkStatus, linkReply, parseLinkCode } from '../_shared/whatsapp/link.ts';
import type { RpcFn } from '../_shared/whatsapp/sender.ts';

export type BotAccess = { access: 'pro' | 'unlinked' | 'not_pro'; user_id: string | null; upsell: boolean };

export type WebhookDeps = {
  rpc: RpcFn;
  /** #1091: run the Pro agent for a linked Pro user. Absent → gate only. */
  onProMessage?: (args: { waId: string; userId: string; text: string; recordId: string | null }) => Promise<void>;
  verifyToken: string;
  appSecret: string;
  skipSignatureVerify: boolean;
};

type InboundMessage = { id?: string; from?: string; type?: string; text?: { body?: string } };

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(deps: WebhookDeps, rawBody: string, header: string | null) {
  if (!deps.appSecret) return deps.skipSignatureVerify;
  if (!header?.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(deps.appSecret, rawBody);
  return timingSafeEqual(header.slice('sha256='.length), expected);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export type MessageOutcome = {
  message_id: string;
  record_id: string | null;
  throttled?: boolean;
  duplicate?: boolean;
  keyword?: string;
  link_status?: string;
  access?: string;
  reply_id?: string | null;
};

async function handleMessage(
  deps: WebhookDeps,
  msg: InboundMessage,
  metadata: unknown,
): Promise<MessageOutcome> {
  const messageId = String(msg.id ?? '');
  const from = msg.from ? String(msg.from) : '';

  // #1089: Meta retries deliveries; claim the wamid first and skip duplicates entirely.
  const { data: claimed, error: claimErr } = await deps.rpc('api_whatsapp_claim_inbound', {
    p_message_id: messageId,
  });
  if (claimErr) throw new Error(claimErr.message);
  if (claimed === false) return { message_id: messageId, record_id: null, duplicate: true };

  try {
    return await processClaimed(deps, msg, metadata, messageId, from);
  } catch (e) {
    // Release so Meta's retry of this delivery is processed instead of skipped.
    await deps.rpc('api_whatsapp_release_inbound', { p_message_id: messageId }).catch(() => undefined);
    throw e;
  }
}

async function processClaimed(
  deps: WebhookDeps,
  msg: InboundMessage,
  metadata: unknown,
  messageId: string,
  from: string,
): Promise<MessageOutcome> {
  let throttled = false;
  if (from) {
    const { data: allowed, error } = await deps.rpc('api_whatsapp_inbound_allowed', { p_wa_id: from });
    if (error) throw new Error(error.message);
    throttled = allowed === false;
  }

  // Throttled phones are not stored or sent to intake (still 200 to Meta, so it does not
  // retry-storm us), but consent keywords are always honoured — STOP must never be lost.
  let outcome: MessageOutcome = { message_id: messageId, record_id: null, throttled: true };
  if (!throttled) {
    const { data: recordId, error: ingErr } = await deps.rpc('api_whatsapp_ingest_inbound', {
      p_message_id: messageId,
      p_payload: { message: msg, metadata: metadata ?? {} },
    });
    if (ingErr) throw new Error(ingErr.message);
    outcome = { message_id: messageId, record_id: (recordId as string) ?? null };
  }

  const text = msg.type === 'text' ? msg.text?.body ?? '' : '';
  if (!from || !text) return outcome;

  const { data: kw, error: kwErr } = await deps.rpc('api_whatsapp_handle_keyword', {
    p_wa_id: from,
    p_text: text,
    p_record_id: outcome.record_id,
  });
  if (kwErr) throw new Error(kwErr.message);
  const res = (kw ?? {}) as { action?: unknown; language?: string };
  if (!isKeywordAction(res.action)) {
    if (outcome.throttled) return outcome;
    if (await maybeRedeemLinkCode(deps, from, text, outcome)) return outcome;
    await gateBot(deps, from, text, outcome);
    return outcome;
  }

  outcome.keyword = res.action;
  const { data: replyId, error: repErr } = await deps.rpc('api_whatsapp_queue_reply', {
    p_wa_id: from,
    p_body: keywordReply(res.action, res.language),
    p_reply_kind: replyKind(res.action),
  });
  if (repErr) throw new Error(repErr.message);
  outcome.reply_id = (replyId as string) ?? null;
  return outcome;
}

// #1090: "123456" / "LINK 123456" from WhatsApp links this number to the app account.
async function maybeRedeemLinkCode(deps: WebhookDeps, from: string, text: string, outcome: MessageOutcome) {
  const parsed = parseLinkCode(text);
  if (!parsed) return false;
  const { data, error } = await deps.rpc('api_whatsapp_redeem_link_code', {
    p_wa_id: from,
    p_code: parsed.code,
  });
  if (error) throw new Error(error.message);
  const status = (data as { status?: unknown } | null)?.status;
  if (!isLinkStatus(status)) return true;
  outcome.link_status = status;
  const { data: replyId, error: repErr } = await deps.rpc('api_whatsapp_queue_reply', {
    p_wa_id: from,
    p_body: linkReply(status, parsed.lang),
    p_reply_kind: 'reply',
  });
  if (repErr) throw new Error(repErr.message);
  outcome.reply_id = (replyId as string) ?? null;
  return true;
}

// #1086: server-enforced Pro gate. Non-Pro gets a rate-limited upsell (DB decides).
async function gateBot(deps: WebhookDeps, from: string, text: string, outcome: MessageOutcome) {
  const { data, error } = await deps.rpc('api_whatsapp_bot_access', { p_wa_id: from });
  if (error) throw new Error(error.message);
  const access = (data ?? {}) as Partial<BotAccess>;
  outcome.access = access.access;
  if (access.access === 'pro' && access.user_id) {
    if (deps.onProMessage) {
      await deps.onProMessage({ waId: from, userId: access.user_id, text, recordId: outcome.record_id });
    }
    return;
  }
  if ((access.access === 'unlinked' || access.access === 'not_pro') && access.upsell) {
    const { data: replyId, error: repErr } = await deps.rpc('api_whatsapp_queue_reply', {
      p_wa_id: from,
      p_body: upsellReply(access.access, detectLang(text)),
      p_reply_kind: 'reply',
    });
    if (repErr) throw new Error(repErr.message);
    outcome.reply_id = (replyId as string) ?? null;
  }
}

export function createWebhookHandler(deps: WebhookDeps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && deps.verifyToken && token === deps.verifyToken && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const rawBody = await req.text();
    if (!(await verifySignature(deps, rawBody, req.headers.get('x-hub-signature-256')))) {
      return new Response('invalid signature', { status: 401 });
    }

    let body: { entry?: { changes?: { value?: { messages?: InboundMessage[]; metadata?: unknown } }[] }[] };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: 'invalid json' }, 400);
    }

    const results: MessageOutcome[] = [];
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const msg of change.value?.messages ?? []) {
            if (!msg?.id) continue;
            results.push(await handleMessage(deps, msg, change.value?.metadata));
          }
        }
      }
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
    return json({ ok: true, record_ids: results.map((r) => r.record_id).filter(Boolean), results });
  };
}
