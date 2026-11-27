// The provider's decision callback (FR-VERIFY-005 AC4). The provider cannot
// send a member token, so the request must carry a valid, fresh provider
// signature, and a missing secret fails closed. A verified decision is turned
// into the normalized payload (document number → keyed identity hash, legal
// name → yes/no match) and handed to `identity_verification_apply`, which
// stores the event and applies it exactly once. The app's "done" redirect
// never sets a level; only this does.
//
// Ported from `supabase/functions/identity-verification-webhook/handler.ts`.

import type { HttpAnswer } from '../../platform/http/httpAnswer';
import type { WebhookRequest } from '../../platform/webhooks/webhookRequest';
import { toDecisionPayload } from './decisionPayload';
import type { IdentityProvider } from './identityProvider';

export interface AppliedEvent {
  readonly id: string;
  readonly status: 'processed' | 'failed';
  readonly errorCode: string | null;
}

export interface WebhookDeps {
  readonly provider: IdentityProvider;
  /** Secret of the identity hash; null or empty means not configured. */
  readonly identityHashKey: string | null;
  /** Display name of the member behind an attempt, for the name match; null when unknown. */
  readonly profileNameForAttempt: (attemptId: string) => Promise<string | null>;
  /** Calls `identity_verification_apply`; rejects on a database error. */
  readonly apply: (providerSlug: string, eventId: string, payload: Record<string, unknown>) => Promise<AppliedEvent>;
  /** Current time in Unix seconds. */
  readonly nowSeconds: () => number;
  /** Receives an infrastructure failure (for the log). */
  readonly report: (error: unknown) => void;
}

/**
 * @returns `200 { ok }` (also for events that change nothing), `401` for a bad signature, `400` for a
 *   body that is not JSON, `422` when the event failed and the provider should resend, `500` for an
 *   infrastructure failure.
 */
export async function receiveVerificationEvent({ headers, rawBody }: WebhookRequest, deps: WebhookDeps): Promise<HttpAnswer> {
  if (!deps.provider.verifyWebhook(headers, rawBody, deps.nowSeconds())) {
    return { status: 401, body: { ok: false, error: 'unauthenticated' } };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid_event' } };
  }
  const decision = deps.provider.parseWebhook(body);
  // Intermediate states (started, in progress, abandoned) are acknowledged and ignored.
  if (!decision) return { status: 200, body: { ok: true, ignored: true } };

  try {
    // Without the hash secret an approval could not be checked against other accounts.
    if (!deps.identityHashKey) throw new Error('IDV_IDENTITY_HASH_KEY is not configured');
    const profileName = decision.attemptId ? await deps.profileNameForAttempt(decision.attemptId) : null;
    const applied = await deps.apply(deps.provider.slug, decision.eventId, toDecisionPayload(decision, deps.identityHashKey, profileName));
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
