// Edge Function: validate-donation-link
// FR-DONATE-008 (insert) + FR-DONATE-009 (update via optional link_id).
// Validates URL reachability server-side, then inserts or updates donation_links
// using the service-role key. Direct INSERT from clients is blocked by RLS.
//
// POST insert: { category_slug, url, display_name, description? }
// POST update: { link_id, category_slug, url, display_name, description? }
// → 200 { ok: true, link }
// → 200 { ok: false, code: 'invalid_input' | 'invalid_url' | 'unreachable' | 'forbidden' }
// → 200 { ok: false, code: 'unauthorized' }
// → 200 { ok: false, code: 'rate_limited' } (insert only)
// → 200 { ok: false, code: 'server_error' }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { type Handler, withObservability } from '../_shared/observability/mod.ts';
import { denoResolve, resolvesOnlyToPublic } from './dnsGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_SLUGS = new Set([
  'time', 'money', 'food', 'housing', 'transport', 'knowledge', 'animals', 'medical',
]);

const MAX_LINKS_PER_HOUR = 10;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECT_HOPS = 3;

// TD-79 / TD-82 — SSRF guard lives in `_shared/ssrfGuard.ts` (port allow-list, host and
// IP-literal checks, DNS resolution check). It runs before the first fetch and again on
// every redirect hop, because redirects are followed manually.
/** A/AAAA lookup used by the guard; a failed family is ignored, an empty result fails closed. */
async function lookupAddresses(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([
    Deno.resolveDns(host, 'A'),
    Deno.resolveDns(host, 'AAAA'),
  ]);
  return [v4, v6].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// Undefined when the runtime has no DNS API: the guard then applies its host / IP-literal checks only.
const resolveAddresses = typeof Deno.resolveDns === 'function' ? lookupAddresses : undefined;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

// Manually follow redirects and re-validate the destination at each hop.
// Closes TD-79 / TD-82 — `redirect: 'follow'` would let a 302 to
// `http://169.254.169.254/latest/meta-data/` escape the initial guard
// check.
async function checkReachable(initial: URL): Promise<boolean> {
  let url = initial;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const safety = await checkUrlSafe(url, resolveAddresses);
    if (!safety.ok) return false;
    if (!(await hostResolvesToPublic(url.hostname))) return false;
    for (const method of ['HEAD', 'GET'] as const) {
      try {
        const resp = await fetch(url.toString(), {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });
        // Redirect — re-validate the next hop. `Location` may be relative.
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location');
          if (!loc) return false;
          let next: URL;
          try {
            next = new URL(loc, url);
          } catch {
            return false;
          }
          if (!/^https?:$/i.test(next.protocol)) return false;
          url = next;
          break; // out of the HEAD/GET loop; outer hop loop re-checks safety.
        }
        // Accept any non-redirect, non-404 status as "reachable". Cloudflare /
        // anti-bot frequently returns 403/503/401 for legitimate sites.
        if (resp.status !== 404) return true;
        if (method === 'HEAD') continue;
        return false;
      } catch {
        // Network error / DNS failure / timeout — try the next method, or fail.
        if (method === 'GET') return false;
      }
    }
  }
  // Exceeded MAX_REDIRECT_HOPS.
  return false;
}

const handler: Handler = async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'invalid_input' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, code: 'unauthorized' }, 200);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ ok: false, code: 'unauthorized' }, 200);
  }
  const userId = userData.user.id;

  let body: {
    link_id?: string;
    category_slug?: string;
    url?: string;
    display_name?: string;
    description?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
  }

  const linkId = typeof body.link_id === 'string' ? body.link_id.trim() : '';
  const slug = body.category_slug;
  const displayName = (body.display_name ?? '').trim();
  const description = body.description == null ? null : String(body.description).trim();

  if (!slug || !ALLOWED_SLUGS.has(slug)) return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
  if (displayName.length < 2 || displayName.length > 80) return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
  if (description !== null && description.length > 280) return jsonResponse({ ok: false, code: 'invalid_input' }, 200);

  const parsed = parseUrl(body.url);
  if (!parsed) return jsonResponse({ ok: false, code: 'invalid_url' }, 200);
  // TD-79 / TD-82 — SSRF host guard. Reject private / loopback / metadata
  // hosts and non-standard ports before issuing any fetch. The reachability
  // check also re-runs this guard on every redirect hop.
  const initialSafety = await checkUrlSafe(parsed, resolveAddresses);
  if (!initialSafety.ok) {
    return jsonResponse({ ok: false, code: 'invalid_url' }, 200);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const reachable = await checkReachable(parsed);
  if (!reachable) {
    return jsonResponse({ ok: false, code: 'unreachable' }, 200);
  }

  if (linkId) {
    const { data: existing, error: fetchErr } = await adminClient
      .from('donation_links')
      .select('*')
      .eq('id', linkId)
      .maybeSingle();
    if (fetchErr || !existing) {
      return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
    }
    if (existing.hidden_at) {
      return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
    }
    const { data: actorRow } = await adminClient
      .from('users')
      .select('is_super_admin')
      .eq('user_id', userId)
      .maybeSingle();
    const isSuperAdmin = actorRow?.is_super_admin === true;
    if (existing.submitted_by !== userId && !isSuperAdmin) {
      return jsonResponse({ ok: false, code: 'forbidden' }, 200);
    }
    if (existing.category_slug !== slug) {
      return jsonResponse({ ok: false, code: 'invalid_input' }, 200);
    }

    const { data: updated, error: updateErr } = await adminClient
      .from('donation_links')
      .update({
        url: parsed.toString(),
        display_name: displayName,
        description: description && description.length > 0 ? description : null,
        validated_at: new Date().toISOString(),
      })
      .eq('id', linkId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      return jsonResponse({ ok: false, code: 'server_error' }, 200);
    }
    return jsonResponse({ ok: true, link: updated }, 200);
  }

  // Soft rate-limit: count rows by this user in the past hour (inserts only).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await adminClient
    .from('donation_links')
    .select('*', { count: 'exact', head: true })
    .eq('submitted_by', userId)
    .gte('created_at', oneHourAgo);
  if (countErr) {
    return jsonResponse({ ok: false, code: 'server_error' }, 200);
  }
  if ((count ?? 0) >= MAX_LINKS_PER_HOUR) {
    return jsonResponse({ ok: false, code: 'rate_limited' }, 200);
  }

  const { data: inserted, error: insertErr } = await adminClient
    .from('donation_links')
    .insert({
      category_slug: slug,
      url: parsed.toString(),
      display_name: displayName,
      description: description && description.length > 0 ? description : null,
      submitted_by: userId,
      validated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    return jsonResponse({ ok: false, code: 'server_error' }, 200);
  }

  return jsonResponse({ ok: true, link: inserted }, 200);
};

serve(withObservability('validate-donation-link', handler));
