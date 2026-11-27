// identity-verification-webhook — the provider's decision callback (FR-VERIFY-005 AC4).
//
// Not behind a Supabase JWT (the provider cannot send one): the request must carry a valid,
// fresh provider signature, and a missing secret fails closed. A verified decision is turned
// into the normalized payload (document number → keyed identity hash, legal name → yes/no
// match) and handed to identity_verification_apply, which stores the event and applies it
// exactly once. The client's "done" redirect never sets a level; only this does.
//
// POST → 200 { ok } (also for events that change nothing) · 401 bad signature · 400 malformed
//        · 422 the event failed and the provider should resend · 500 infrastructure failure

import { toDecisionPayload } from '../_shared/identity/decisionPayload.ts';
import type { IdentityProvider } from '../_shared/identity/provider.ts';

export interface AppliedEvent {
  readonly id: string;
  readonly status: 'processed' | 'failed';
  readonly errorCode: string | null;
}

export interface WebhookHandlerDeps {
  readonly provider: IdentityProvider;
  /** Secret of the identity hash (`IDV_IDENTITY_HASH_KEY`); empty means not configured. */
  readonly identityHashKey: string;
  /** Display name of the member behind an attempt, for the name match; null when unknown. */
  readonly profileNameForAttempt: (attemptId: string) => Promise<string | null>;
  /** Calls identity_verification_apply; rejects on a database error. */
  readonly apply: (providerSlug: string, eventId: string, payload: Record<string, unknown>) => Promise<AppliedEvent>;
  /** Current time in Unix seconds (injected for tests). */
  readonly nowSeconds: () => number;
  readonly report: (error: unknown) => Promise<void>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createWebhookHandler(deps: WebhookHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const raw = await req.text();
    if (!await deps.provider.verifyWebhook(req.headers, raw, deps.nowSeconds())) {
      return json({ ok: false, error: 'unauthenticated' }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: 'invalid_event' }, 400);
    }
    const decision = deps.provider.parseWebhook(body);
    // Intermediate states (started, in progress, abandoned) are acknowledged and ignored.
    if (!decision) return json({ ok: true, ignored: true });

    try {
      // Without the hash secret an approval could not be checked against other accounts.
      if (!deps.identityHashKey) throw new Error('IDV_IDENTITY_HASH_KEY is not configured');
      const profileName = decision.attemptId ? await deps.profileNameForAttempt(decision.attemptId) : null;
      const payload = await toDecisionPayload(decision, deps.identityHashKey, profileName);
      const applied = await deps.apply(deps.provider.slug, decision.eventId, payload);
      // A non-2xx answer makes the provider resend; the stored event is applied again then.
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
