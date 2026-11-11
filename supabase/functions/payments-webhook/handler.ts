// payments-webhook — the intake of payment-provider events
// (supabase/schemas/85_billing/080_provider_events.sql). The provider's callback cannot
// carry a Supabase credential, so this function authenticates the event itself: the body must
// be signed with the shared secret of the provider it names (HMAC-SHA256 over the exact
// request text, hex, header `x-kc-signature: sha256=<hex>`), and a provider with no
// configured secret is rejected, so a missing secret never opens the endpoint. The verified
// event is handed to provider_webhook_apply, which stores it and applies it exactly once.
//
// Body: { provider_slug, provider_event_id, payload } where payload is the normalized event
// (`{ type: 'payment.succeeded', intent_id, provider_ref, amount_agorot? }`, and the other
// types listed in 080_provider_events.sql). The event id is the provider's own: it is the
// idempotency key, so it is never generated here.

/** The stored provider event and how applying it ended; `errorCode` is set when it failed. */
export interface AppliedEvent {
  readonly id: string;
  readonly status: 'processed' | 'failed';
  readonly errorCode: string | null;
}

export interface PaymentsWebhookDeps {
  /** The signing secret of a provider, or null when none is configured. */
  readonly secretFor: (providerSlug: string) => string | null;
  /** Calls `provider_webhook_apply`; resolves to the stored event and its outcome, rejects on a database error. */
  readonly apply: (providerSlug: string, eventId: string, payload: Record<string, unknown>) => Promise<AppliedEvent>;
  /** Receives an infrastructure failure; the response never carries its cause. */
  readonly report: (error: unknown) => Promise<void>;
}

const encoder = new TextEncoder();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The signature header value for `body` under `secret`: `sha256=<hex HMAC-SHA256>`. */
export async function signBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that depends only on their length, not their content. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** True when the text is a JSON object (not an array, not null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** POST → 200 { ok, webhook_event_id }; 401 for a bad signature; 400 for a malformed event; 500 to make the provider retry. */
export function createPaymentsWebhookHandler(deps: PaymentsWebhookDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

    const text = await req.text();
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch {
      return json({ ok: false, error: 'unauthenticated' }, 401);
    }
    // The provider named in the body selects the secret; the signature then covers that very text.
    const slug = isObject(event) && typeof event.provider_slug === 'string' ? event.provider_slug : '';
    const secret = slug ? deps.secretFor(slug) : null;
    const given = req.headers.get('x-kc-signature') ?? '';
    if (!secret || !timingSafeEqual(given, await signBody(text, secret))) {
      return json({ ok: false, error: 'unauthenticated' }, 401);
    }

    const eventId = isObject(event) ? event.provider_event_id : undefined;
    const payload = isObject(event) ? event.payload : undefined;
    if (typeof eventId !== 'string' || eventId === '' || !isObject(payload)) {
      return json({ ok: false, error: 'invalid_event' }, 400);
    }
    try {
      const applied = await deps.apply(slug, eventId, payload);
      // A non-2xx answer makes the provider resend; the stored event is retried on the resend.
      if (applied.status === 'failed') {
        return json({ ok: false, error: 'event_failed', code: applied.errorCode, webhook_event_id: applied.id }, 422);
      }
      return json({ ok: true, webhook_event_id: applied.id });
    } catch (error) {
      await deps.report(error);
      return json({ ok: false, error: 'internal' }, 500);
    }
  };
}
