// What the WhatsApp channel does with each message a member sends (#843 ingest, #937 consent
// keywords, #938 per-phone throttle, #1086 Pro gate, #1089 duplicate deliveries, #1090 link
// codes). Ported from supabase/functions/whatsapp-webhook; every decision is the database's
// (one function call each), and this module only orders the calls. Dependencies are injected.

import { isLinkStatus, linkReply, parseLinkCode } from './link';
import { detectLang, isKeywordAction, keywordReply, replyKind, upsellReply } from './replies';

/** One database function call of the channel (service role). */
export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export type BotAccess = { access: 'pro' | 'unlinked' | 'not_pro' | 'inactive'; user_id: string | null; upsell: boolean };

export type InboundDeps = {
  rpc: RpcFn;
  /** #1091: run the Pro agent for a linked Pro user. Absent → gate only. */
  onProMessage?: (args: { waId: string; userId: string; text: string; recordId: string | null }) => Promise<void>;
  /** D158: a photo from a linked Pro user, for their waiting bot draft. Absent → ignored. */
  onProPhoto?: (args: ProPhoto) => Promise<void>;
};

export type ProPhoto = {
  waId: string;
  userId: string;
  mediaId: string;
  mimeType: string | null;
  caption: string;
  recordId: string | null;
};

export type InboundMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
};

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
  deps: InboundDeps,
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
  deps: InboundDeps,
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

  if (msg.type === 'image') {
    if (from && !outcome.throttled) await gateBot(deps, from, msg.image?.caption ?? '', outcome, onPhoto(deps, from, msg));
    return outcome;
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
    await gateBot(deps, from, text, outcome, (userId, recordId) =>
      deps.onProMessage?.({ waId: from, userId, text, recordId }) ?? Promise.resolve());
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
async function maybeRedeemLinkCode(deps: InboundDeps, from: string, text: string, outcome: MessageOutcome) {
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

type ProHandler = (userId: string, recordId: string | null) => Promise<void>;

// D158: an image goes to the photo flow (its waiting draft), never to the language model.
function onPhoto(deps: InboundDeps, from: string, msg: InboundMessage): ProHandler {
  return (userId, recordId) => {
    const mediaId = msg.image?.id ? String(msg.image.id) : '';
    if (!mediaId || !deps.onProPhoto) return Promise.resolve();
    return deps.onProPhoto({
      waId: from,
      userId,
      mediaId,
      mimeType: msg.image?.mime_type ?? null,
      caption: msg.image?.caption ?? '',
      recordId,
    });
  };
}

// #1086: server-enforced Pro gate. Non-Pro gets a rate-limited upsell (DB decides).
async function gateBot(deps: InboundDeps, from: string, text: string, outcome: MessageOutcome, onPro: ProHandler) {
  const { data, error } = await deps.rpc('api_whatsapp_bot_access', { p_wa_id: from });
  if (error) throw new Error(error.message);
  const access = (data ?? {}) as Partial<BotAccess>;
  outcome.access = access.access;
  // A number linked to a deactivated account gets no agent and no upsell: silence.
  if (access.access === 'inactive') return;
  if (access.access === 'pro' && access.user_id) {
    await onPro(access.user_id, outcome.record_id);
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

/** The body of a delivery: the provider groups messages by entry and change. */
export interface InboundDelivery {
  entry?: { changes?: { value?: { messages?: InboundMessage[]; metadata?: unknown } }[] }[];
}

/**
 * Handles every message of one delivery, in order. A message without an id is skipped.
 * @throws When a database call fails: the message's claim was released, so the provider's
 *   retry of the delivery is processed.
 */
export async function handleDelivery(deps: InboundDeps, delivery: InboundDelivery): Promise<MessageOutcome[]> {
  const outcomes: MessageOutcome[] = [];
  for (const entry of delivery.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (!message?.id) continue;
        outcomes.push(await handleMessage(deps, message, change.value?.metadata));
      }
    }
  }
  return outcomes;
}
