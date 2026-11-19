// _shared/serviceRoleGuard.ts — caller check for service-role-only Edge Functions (#1067).
//
// These workers act with the service role, so they accept exactly one caller credential:
// the service-role key as the bearer token, which their callers (pg_cron, operators) send.

/** Workers that may be invoked with the service-role key only (see the regression test). */
export const SERVICE_ROLE_ONLY_FUNCTIONS = [
  'backfill-image-thumbs',
  'dispatch-notification',
  'embed-worker',
  'match-rerank',
  'purge-deleted-accounts',
  'reconcile-storage-orphans',
  'rotate-research-salt',
  'strip-exif',
  'subscriptions-charger',
  'whatsapp-sender',
] as const;

const encoder = new TextEncoder();

/** Compares two strings in time that depends only on their length, not their content. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * Every key the runtime currently treats as service-role: the injected
 * SUPABASE_SERVICE_ROLE_KEY plus any comma-separated SUPABASE_SECRET_KEYS
 * (the JWT Signing Keys migration can change either). Empties dropped, deduped.
 */
export function currentServiceRoleKeys(env: { get(name: string): string | undefined } = Deno.env): string[] {
  const keys: string[] = [];
  const primary = env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (primary) keys.push(primary);
  for (const raw of (env.get('SUPABASE_SECRET_KEYS') ?? '').split(',')) {
    const k = raw.trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** First configured service-role key, for building the admin client; '' when none. */
export function primaryServiceRoleKey(env: { get(name: string): string | undefined } = Deno.env): string {
  return currentServiceRoleKeys(env)[0] ?? '';
}

/**
 * True only for `Authorization: Bearer <key>` where key is one of the configured
 * service-role keys. A function without a configured key rejects every caller,
 * so a missing secret never opens the endpoint.
 */
export function isServiceRoleRequest(req: Request, serviceKey: string | string[]): boolean {
  const keys = (Array.isArray(serviceKey) ? serviceKey : [serviceKey]).filter((k) => k);
  if (keys.length === 0) return false;
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const bearer = header.slice('Bearer '.length);
  return keys.some((key) => timingSafeEqual(bearer, key));
}

/** The 401 body every guarded worker answers with. */
export function serviceRoleRequiredResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
