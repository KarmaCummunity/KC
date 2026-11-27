// One batch of outbound WhatsApp messages (issue #938): claim, send through Meta, report
// each result. All rate limiting, consent re-checks and back-off live in the database
// (`api_whatsapp_outbound_claim`, `api_whatsapp_outbound_result`).
//
// Ported from `supabase/functions/_shared/whatsapp/sender.ts`.

import type { OutboundMessage, SendResult } from './metaClient';
import { resolveTemplateParams } from './templates';

export type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type OutboundRow = {
  outbound_id: string;
  kind: 'template' | 'session';
  to_wa_id: string | null;
  language: string | null;
  template_name: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
};

export type BatchSummary = { claimed: number; sent: number; retried: number; failed: number };

/** The message of a queued row, or null when the row cannot be sent as it is. */
export function toOutboundMessage(row: OutboundRow): OutboundMessage | null {
  if (!row.to_wa_id) return null;
  if (row.kind === 'session') {
    return row.body ? { kind: 'session', to: row.to_wa_id, body: row.body } : null;
  }
  if (!row.template_name) return null;
  const language = row.language ?? 'he';
  // Explicit ordered params win; otherwise resolve named params from the registry (#936).
  const raw = row.payload?.params;
  const params = Array.isArray(raw)
    ? raw.map((p) => String(p))
    : resolveTemplateParams(row.template_name, language, row.payload);
  if (!params) return null; // unknown template or missing param → fail, never send broken text
  return { kind: 'template', to: row.to_wa_id, templateName: row.template_name, language, params };
}

/** Claims a batch and sends it. Rejects when the claim or a result report fails. */
export async function runSenderBatch(opts: {
  rpc: RpcFn;
  send: (msg: OutboundMessage) => Promise<SendResult>;
  batch?: number;
  visibilitySeconds?: number;
}): Promise<BatchSummary> {
  const { data, error } = await opts.rpc('api_whatsapp_outbound_claim', {
    p_batch: opts.batch ?? 20,
    p_visibility_seconds: opts.visibilitySeconds ?? 60,
  });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as OutboundRow[];
  const summary: BatchSummary = { claimed: rows.length, sent: 0, retried: 0, failed: 0 };

  for (const row of rows) {
    const msg = toOutboundMessage(row);
    const result: SendResult = msg
      ? await opts.send(msg)
      : { ok: false, error: 'malformed outbound row', retryable: false };
    const { data: status, error: resErr } = await opts.rpc('api_whatsapp_outbound_result', {
      p_outbound_id: row.outbound_id,
      p_ok: result.ok,
      p_wa_message_id: result.ok ? result.waMessageId : null,
      p_error: result.ok ? null : result.error,
      p_retryable: result.ok ? false : result.retryable,
    });
    if (resErr) throw new Error(`result failed: ${resErr.message}`);
    if (status === 'sent') summary.sent++;
    else if (status === 'queued') summary.retried++;
    else summary.failed++;
  }
  return summary;
}
