// RevenueCat reports purchases; this keeps KC's entitlements in step: a
// member's Pro tier and an organization's paid plan. The request is accepted
// only with the shared secret RevenueCat sends in its Authorization header.
//
// Ported from `supabase/functions/revenuecat-webhook/handler.ts`: same events,
// same answers.

import type { HttpAnswer } from '../../platform/http/httpAnswer';
import { equalInConstantTime } from '../../platform/security/constantTime';
import type { WebhookRequest } from '../../platform/webhooks/webhookRequest';

export interface RevenueCatDeps {
  /** The shared secret; null means not configured, and every event is then refused. */
  readonly authSecret: string | null;
  /** Entitlement of a member's Pro tier. */
  readonly proEntitlementId: string;
  /** Entitlement of an organization's paid plan. */
  readonly orgEntitlementId: string;
  /** Sets a member's Pro tier; resolves to the database's answer, rejects on a database error. */
  readonly setMemberPro: (userId: string, active: boolean, expiresAt: string | null) => Promise<unknown>;
  /** Sets an organization's plan; resolves to the database's answer, rejects on a database error. */
  readonly setOrganizationPlan: (organizationId: string, active: boolean, expiresAt: string | null) => Promise<unknown>;
  /** Receives a database failure (for the log). */
  readonly report: (error: unknown) => void;
  /** Current time in milliseconds; replaced in tests. */
  readonly now?: () => number;
}

/** Events after which the holder has the entitlement (until it expires). */
const GRANTING_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
/** Events after which the holder no longer has it. */
const REVOKING_EVENTS = new Set(['EXPIRATION']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * An organization buys under the app user id `org:<organization uuid>`:
 * RevenueCat sends subscriber attributes only on some events, whereas the app
 * user id (or an alias) is always present.
 */
const ORGANIZATION_ID = /^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const answer = (status: number, body: unknown): HttpAnswer => ({ status, body });

/** The `event` object of a delivery; null when the body is not JSON. */
function eventOf(rawBody: string): Record<string, unknown> | null {
  try {
    return ((JSON.parse(rawBody) as { event?: Record<string, unknown> }).event ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * @returns `200` with what was done (or why nothing was), `401 unauthorized`, `400 bad_json`,
 *   `503 not_configured`, or `500 rpc_failed` so RevenueCat sends the event again.
 */
export async function receiveRevenueCatEvent({ headers, rawBody }: WebhookRequest, deps: RevenueCatDeps): Promise<HttpAnswer> {
  if (!deps.authSecret) return answer(503, { error: 'not_configured' });
  const authorization = headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : authorization;
  if (!equalInConstantTime(token, deps.authSecret)) return answer(401, { error: 'unauthorized' });

  const event = eventOf(rawBody);
  if (!event) return answer(400, { error: 'bad_json' });
  const type = String(event.type ?? '');
  if (type === 'TEST') return answer(200, { status: 'test_ok' });
  if (!GRANTING_EVENTS.has(type) && !REVOKING_EVENTS.has(type)) return answer(200, { status: 'ignored_type' });

  const subscriberIds = [event.app_user_id, event.original_app_user_id, ...(Array.isArray(event.aliases) ? (event.aliases as unknown[]) : [])].map(String);
  const organizationId = subscriberIds.map((id) => ORGANIZATION_ID.exec(id)?.[1]).find((id) => id !== undefined);
  const userId = subscriberIds.find((id) => UUID.test(id));
  if (!organizationId && !userId) return answer(200, { status: 'no_kc_user' });

  // The entitlement decides who holds the plan, so a subscriber known under both ids never has one
  // purchase land on the wrong holder. An event without entitlement ids (a bare expiration) goes to
  // the organization first.
  const entitlements = Array.isArray(event.entitlement_ids) ? (event.entitlement_ids as unknown[]).map(String) : [];
  const names = (entitlementId: string) => entitlements.length === 0 || entitlements.includes(entitlementId);
  const forOrganization = organizationId !== undefined && names(deps.orgEntitlementId);
  const forMember = !forOrganization && userId !== undefined && names(deps.proEntitlementId);
  if (!forOrganization && !forMember) return answer(200, { status: 'ignored_entitlement' });

  const expiresAtMs = typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null;
  const active = GRANTING_EVENTS.has(type) && (expiresAtMs === null || expiresAtMs > (deps.now ?? Date.now)());
  const expiresAt = expiresAtMs === null ? null : new Date(expiresAtMs).toISOString();
  try {
    const result = forOrganization
      ? await deps.setOrganizationPlan(organizationId as string, active, expiresAt)
      : await deps.setMemberPro(userId as string, active, expiresAt);
    return answer(200, result ?? { status: 'ok' });
  } catch (error) {
    deps.report(error);
    return answer(500, { error: 'rpc_failed' });
  }
}
