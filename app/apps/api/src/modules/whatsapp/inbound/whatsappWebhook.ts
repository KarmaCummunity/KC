import { createHmac } from 'node:crypto';
import type { HttpAnswer } from '../../../platform/http/httpAnswer';
import { equalInConstantTime } from '../../../platform/security/constantTime';
import type { WebhookRequest } from '../../../platform/webhooks/webhookRequest';
import { handleDelivery, type InboundDelivery, type InboundDeps } from './inboundMessages';

/** Header that carries the provider's signature of the raw body: `sha256=<hex>`. */
const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

export interface WhatsAppWebhookDeps extends InboundDeps {
  /** The token the provider echoes when the webhook is registered; null: registration is refused. */
  readonly verifyToken: string | null;
  /** The app secret deliveries are signed with; null: every delivery is refused. */
  readonly appSecret: string | null;
  /** Receives a failure of a delivery; never the message. */
  readonly report: (error: unknown) => void;
}

const text = (status: number, body: string): HttpAnswer => ({ status, body });

/**
 * The provider's check when the webhook is registered in its console: it
 * sends the token it was given and expects its challenge back.
 * @param query The request's query parameters (`hub.mode`, `hub.verify_token`, `hub.challenge`).
 */
export function verifySubscription(query: Readonly<Record<string, unknown>>, verifyToken: string | null): HttpAnswer {
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const matches = verifyToken !== null && typeof token === 'string' && equalInConstantTime(token, verifyToken);
  return query['hub.mode'] === 'subscribe' && matches && typeof challenge === 'string' && challenge !== '' ? text(200, challenge) : text(403, 'forbidden');
}

/** True when the delivery carries the signature of exactly this body under the app secret. */
function isSigned(webhook: WebhookRequest, appSecret: string | null): boolean {
  const header = webhook.headers.get(SIGNATURE_HEADER);
  // No secret configured: nothing can be verified, so nothing is accepted.
  if (appSecret === null || !header?.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = createHmac('sha256', appSecret).update(webhook.rawBody).digest('hex');
  return equalInConstantTime(header.slice(SIGNATURE_PREFIX.length), expected);
}

/**
 * One delivery of inbound messages. Answers in the provider's protocol: 200
 * once every message was handled (a throttled or duplicate message is
 * handled), 401 for a delivery that is not signed, 500 when one could not be
 * handled, so the provider sends it again.
 */
export async function receiveDelivery(webhook: WebhookRequest, deps: WhatsAppWebhookDeps): Promise<HttpAnswer> {
  if (!isSigned(webhook, deps.appSecret)) return text(401, 'invalid signature');
  let delivery: InboundDelivery;
  try {
    delivery = JSON.parse(webhook.rawBody) as InboundDelivery;
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid json' } };
  }
  try {
    const results = await handleDelivery(deps, delivery ?? {});
    return { status: 200, body: { ok: true, record_ids: results.map((result) => result.record_id).filter(Boolean), results } };
  } catch (error) {
    deps.report(error);
    // The cause stays in the log: the provider needs only to know it must retry.
    return { status: 500, body: { ok: false, error: 'delivery_failed' } };
  }
}
