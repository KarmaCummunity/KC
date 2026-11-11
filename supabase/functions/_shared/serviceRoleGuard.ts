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
  'whatsapp-intake-worker',
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
 * True only for `Authorization: Bearer <serviceKey>`. A function without a configured
 * key rejects every caller, so a missing secret never opens the endpoint.
 */
export function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  if (!serviceKey) return false;
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqual(header.slice('Bearer '.length), serviceKey);
}

/** The 401 body every guarded worker answers with. */
export function serviceRoleRequiredResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
