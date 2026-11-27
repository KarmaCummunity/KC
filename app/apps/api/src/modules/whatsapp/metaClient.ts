// A minimal client of Meta's WhatsApp Cloud API (issue #938). `fetch` is injectable for
// tests; no secret is ever logged or returned.
//
// Ported from `supabase/functions/_shared/whatsapp/meta.ts`.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type MetaConfig = {
  token: string;
  phoneNumberId: string;
  graphVersion?: string;
  baseUrl?: string;
};

export type OutboundMessage =
  | { kind: 'session'; to: string; body: string }
  | {
    kind: 'template';
    to: string;
    templateName: string;
    language: string;
    /** Ordered body parameters ({{1}}, {{2}}, …) */
    params?: string[];
  };

export type SendResult =
  | { ok: true; waMessageId: string | null }
  | { ok: false; error: string; retryable: boolean };

/** Meta error codes worth another attempt later (throttling and transient failures). */
const RETRYABLE_META_CODES = new Set([4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** True when a failed send should be tried again later. */
export function classifyFailure(status: number, metaCode: number | null): boolean {
  if (metaCode !== null && RETRYABLE_META_CODES.has(metaCode)) return true;
  if (status === 429 || status >= 500) return true;
  return false; // 4xx such as 131047 (outside 24h window), 131026 (undeliverable), 132001 (template)
}

/** The request body of one message, as the Cloud API takes it. */
export function buildPayload(msg: OutboundMessage): Record<string, unknown> {
  if (msg.kind === 'session') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.to,
      type: 'text',
      text: { preview_url: false, body: msg.body },
    };
  }
  const template: Record<string, unknown> = {
    name: msg.templateName,
    language: { code: msg.language },
  };
  if (msg.params && msg.params.length > 0) {
    template.components = [{
      type: 'body',
      parameters: msg.params.map((text) => ({ type: 'text', text })),
    }];
  }
  return { messaging_product: 'whatsapp', to: msg.to, type: 'template', template };
}

/** Sends one message. Never rejects: a failure is a result that says whether to try again. */
export async function sendMessage(cfg: MetaConfig, msg: OutboundMessage, fetchFn: FetchFn = (input, init) => fetch(input, init)): Promise<SendResult> {
  const base = cfg.baseUrl ?? 'https://graph.facebook.com';
  const url = `${base}/${cfg.graphVersion ?? 'v21.0'}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(msg)),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`, retryable: true };
  }

  const json = (await res.json().catch(() => null)) as
    | { messages?: { id?: string }[]; error?: { code?: number; message?: string } }
    | null;
  if (res.ok) {
    return { ok: true, waMessageId: json?.messages?.[0]?.id ?? null };
  }
  const code = typeof json?.error?.code === 'number' ? json.error.code : null;
  const message = json?.error?.message ?? res.statusText ?? 'error';
  return {
    ok: false,
    error: `HTTP ${res.status}${code !== null ? ` code ${code}` : ''}: ${message}`.slice(0, 500),
    retryable: classifyFailure(res.status, code),
  };
}
