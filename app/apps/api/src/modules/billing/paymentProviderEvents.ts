// The intake of payment-provider events (the `provider_events` tables of the
// billing schema). A provider's callback carries no member token, so the event
// is authenticated here: the body must be signed with the shared secret of the
// provider it names (HMAC-SHA256 over the exact request text, hex, in the
// header `x-kc-signature: sha256=<hex>`), and a provider with no configured
// secret is refused, so a missing secret never opens the route. The verified
// event goes to `provider_webhook_apply`, which stores it and applies it
// exactly once.
//
// Body: `{ provider_slug, provider_event_id, payload }`, where the payload is
// the normalized event (for example `{ type: 'payment.succeeded', intent_id,
// provider_ref, amount_agorot? }`). The event id is the provider's own: it is
// the idempotency key, so it is never generated here.
//
// Ported from `supabase/functions/payments-webhook/handler.ts`.

import { createHmac } from 'node:crypto';
import type { HttpAnswer } from '../../platform/http/httpAnswer';
import { equalInConstantTime } from '../../platform/security/constantTime';
import type { WebhookRequest } from '../../platform/webhooks/webhookRequest';

/** The stored provider event and how applying it ended; `errorCode` is set when it failed. */
export interface AppliedEvent {
  readonly id: string;
  readonly status: 'processed' | 'failed';
  readonly errorCode: string | null;
}

export interface PaymentEventDeps {
  /** The signing secret of a provider, or null when none is configured. */
  readonly secretFor: (providerSlug: string) => string | null;
  /** Calls `provider_webhook_apply`; rejects on a database error. */
  readonly apply: (providerSlug: string, eventId: string, payload: Record<string, unknown>) => Promise<AppliedEvent>;
  /** Receives an infrastructure failure (for the log); the answer never carries its cause. */
  readonly report: (error: unknown) => void;
}

const UNAUTHENTICATED: HttpAnswer = { status: 401, body: { ok: false, error: 'unauthenticated' } };

/** The signature header value for `body` under `secret`: `sha256=<hex HMAC-SHA256>`. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @returns `200 { ok, webhook_event_id }`, `401` for a bad signature (or a body whose provider cannot
 *   be read), `400` for a malformed event, `422` when the event failed and the provider should
 *   resend, `500` for an infrastructure failure.
 */
export async function receivePaymentEvent({ headers, rawBody }: WebhookRequest, deps: PaymentEventDeps): Promise<HttpAnswer> {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return UNAUTHENTICATED;
  }
  // The provider named in the body selects the secret; the signature then covers that very text.
  const slug = isObject(event) && typeof event.provider_slug === 'string' ? event.provider_slug : '';
  const secret = slug ? deps.secretFor(slug) : null;
  if (!secret || !equalInConstantTime(headers.get('x-kc-signature') ?? '', signBody(rawBody, secret))) return UNAUTHENTICATED;

  const eventId = isObject(event) ? event.provider_event_id : undefined;
  const payload = isObject(event) ? event.payload : undefined;
  if (typeof eventId !== 'string' || eventId === '' || !isObject(payload)) {
    return { status: 400, body: { ok: false, error: 'invalid_event' } };
  }
  try {
    const applied = await deps.apply(slug, eventId, payload);
    // A non-2xx answer makes the provider resend; the stored event is applied again then.
    if (applied.status === 'failed') {
      return { status: 422, body: { ok: false, error: 'event_failed', code: applied.errorCode, webhook_event_id: applied.id } };
    }
    return { status: 200, body: { ok: true, webhook_event_id: applied.id } };
  } catch (error) {
    deps.report(error);
    return { status: 500, body: { ok: false, error: 'internal' } };
  }
}
