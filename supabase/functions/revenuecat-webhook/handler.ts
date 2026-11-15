// revenuecat-webhook — RevenueCat → Pro sync. Auth: shared Authorization header (secret REVENUECAT_WEBHOOK_AUTH).
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type Deps = {
  rpc: Rpc;
  authSecret: string;
  /** Entitlement of a member's Pro tier. */
  entitlementId: string;
  /** Entitlement of an organization's paid plan. */
  orgEntitlementId: string;
  now?: () => number;
};

const GRANT = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
const REVOKE = new Set(['EXPIRATION']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An organization purchase is made under the app user id `org:<organization uuid>`: RevenueCat sends
// subscriber attributes only on some events, whereas the app user id (or an alias) is always present.
const ORG_ID = /^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createRevenueCatHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!deps.authSecret) return json(503, { error: 'not_configured' });
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (!safeEqual(token, deps.authSecret)) return json(401, { error: 'unauthorized' });

    let ev: Record<string, unknown>;
    try { ev = ((await req.json()) as { event?: Record<string, unknown> }).event ?? {}; }
    catch { return json(400, { error: 'bad_json' }); }

    const type = String(ev.type ?? '');
    if (type === 'TEST') return json(200, { status: 'test_ok' });
    const ents = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids.map(String) : [];
    if (!GRANT.has(type) && !REVOKE.has(type)) return json(200, { status: 'ignored_type' });

    const ids = [ev.app_user_id, ev.original_app_user_id, ...(Array.isArray(ev.aliases) ? ev.aliases : [])].map(String);
    const orgId = ids.map((x) => ORG_ID.exec(x)?.[1]).find((x) => x !== undefined);
    const userId = ids.find((x) => UUID.test(x));
    if (!orgId && !userId) return json(200, { status: 'no_kc_user' });
    // The entitlement decides who holds the plan, so a subscriber known under both ids never has one
    // purchase land on the wrong holder. An event without entitlement ids (a bare expiration) goes to the
    // organization first.
    const forOrg = orgId !== undefined && (!ents.length || ents.includes(deps.orgEntitlementId));
    const forMember = !forOrg && userId !== undefined && (!ents.length || ents.includes(deps.entitlementId));
    if (!forOrg && !forMember) return json(200, { status: 'ignored_entitlement' });

    const expMs = typeof ev.expiration_at_ms === 'number' ? ev.expiration_at_ms : null;
    const now = (deps.now ?? Date.now)();
    const active = GRANT.has(type) && (expMs === null || expMs > now);
    const expiresAt = expMs === null ? null : new Date(expMs).toISOString();
    const { data, error } = forOrg
      ? await deps.rpc('api_revenuecat_set_org_entitlement', { p_org_id: orgId, p_active: active, p_expires_at: expiresAt })
      : await deps.rpc('api_revenuecat_set_pro', { p_user_id: userId, p_active: active, p_expires_at: expiresAt });
    if (error) return json(500, { error: 'rpc_failed' }); // RevenueCat retries non-2xx
    return json(200, data ?? { status: 'ok' });
  };
}
