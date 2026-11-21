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
 * SUPABASE_SERVICE_ROLE_KEY plus SUPABASE_SECRET_KEYS. The runtime exposes the
 * secret keys as a JSON map of name to key (the new API keys); a comma-separated
 * list is accepted too, so a rotation cannot lock the workers out either way.
 * Empties dropped, deduped.
 */
export function currentServiceRoleKeys(env: { get(name: string): string | undefined } = Deno.env): string[] {
  const keys: string[] = [];
  const add = (k: string) => {
    const v = k.trim();
    if (v && !keys.includes(v)) keys.push(v);
  };
  add(env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const extras = (env.get('SUPABASE_SECRET_KEYS') ?? '').trim();
  if (extras.startsWith('{') || extras.startsWith('[')) {
    // The runtime's JSON map form: a plain object of name to key. Anything else
    // (malformed JSON, an array, nested or non-string values) yields NO extras;
    // it never falls back to splitting JSON text on commas.
    try {
      const parsed: unknown = JSON.parse(extras);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const v of Object.values(parsed)) {
          if (typeof v === 'string') add(v);
        }
      }
    } catch { /* malformed JSON: no extras */ }
  } else {
    for (const raw of extras.split(',')) add(raw);
  }
  return keys;
}

/** First configured service-role key, for building the admin client; '' when none. */
export function primaryServiceRoleKey(env: { get(name: string): string | undefined } = Deno.env): string {
  return currentServiceRoleKeys(env)[0] ?? '';
}

/**
 * True only when the caller presented one of the configured service-role keys,
 * as `Authorization: Bearer <key>` (legacy JWT callers) or as the `apikey`
 * header (pg_net with a new sb_secret key, which is not a JWT and cannot ride
 * the bearer header). A function without a configured key rejects every caller,
 * so a missing secret never opens the endpoint.
 */
export function isServiceRoleRequest(req: Request, serviceKey: string | string[]): boolean {
  const keys = (Array.isArray(serviceKey) ? serviceKey : [serviceKey]).filter((k) => k);
  if (keys.length === 0) return false;
  const header = req.headers.get('Authorization') ?? '';
  if (header.startsWith('Bearer ') && keys.some((key) => timingSafeEqual(header.slice('Bearer '.length), key))) {
    return true;
  }
  const apikey = req.headers.get('apikey') ?? '';
  return apikey !== '' && keys.some((key) => timingSafeEqual(apikey, key));
}

/** The 401 body every guarded worker answers with. */
export function serviceRoleRequiredResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
