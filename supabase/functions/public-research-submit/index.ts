// public-research-submit — FR-RESEARCH-002
//
// Public gateway for anonymous Survey B (alt-platforms-research) submissions.
// Handles CORS origin allowlist, client-IP extraction, daily-salt hashing,
// and delegates all rate-limiting + circuit-breaker logic to the
// submit_public_research_response Postgres RPC (migration 0123).
//
// POST { slug, version, source?, answers, honeypot, contactEmail?, contactWindowHe? }
//   → 200 { responseId: uuid }
//   → 400 { error: 'invalid_body' | 'survey_not_found' }
//   → 403 { error: 'origin_not_allowed' }
//   → 405 { error: 'method_not_allowed' }
//   → 429 { error: 'rate_limited', period: 'minute' | 'hour' | 'day' }
//   → 500 { error: 'salt_missing' | 'internal' }
//   → 503 { error: 'circuit_open' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { reportError, withObservability } from '../_shared/observability/mod.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('EXPO_PUBLIC_SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LOCAL_IP_PLACEHOLDER = '127.0.0.1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  console.warn('[public-research-submit] no client IP header found; using placeholder');
  return LOCAL_IP_PLACEHOLDER;
}

interface AnswerEntry {
  rating?: number;
  answer_text?: string | null;
}

interface RequestBody {
  slug: string;
  version: number;
  source?: string;
  answers: Record<string, AnswerEntry>;
  honeypot: string;
  contactEmail?: string;
  contactWindowHe?: string;
}

function isValidBody(b: unknown): b is RequestBody {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.slug !== 'string' || !o.slug) return false;
  if (typeof o.version !== 'number') return false;
  if (typeof o.answers !== 'object' || o.answers === null || Array.isArray(o.answers)) return false;
  if (typeof o.honeypot !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// RPC error → HTTP mapping
// ---------------------------------------------------------------------------

type RpcErrorResult = { status: number; body: Record<string, string> };

function mapRpcError(message: string): RpcErrorResult {
  if (message.includes('rate_limited_minute')) {
    return { status: 429, body: { error: 'rate_limited', period: 'minute' } };
  }
  if (message.includes('rate_limited_hour')) {
    return { status: 429, body: { error: 'rate_limited', period: 'hour' } };
  }
  if (message.includes('rate_limited_day')) {
    return { status: 429, body: { error: 'rate_limited', period: 'day' } };
  }
  if (message.includes('research_circuit_open')) {
    return { status: 503, body: { error: 'circuit_open' } };
  }
  if (message.includes('survey_not_found_or_version_mismatch')) {
    return { status: 400, body: { error: 'survey_not_found' } };
  }
  return { status: 500, body: { error: 'internal' } };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(withObservability('public-research-submit', async (req) => {
  const origin = req.headers.get('origin');

  // Preflight
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) {
      return json({ error: 'origin_not_allowed' }, 403);
    }
    return new Response('ok', { status: 200, headers: corsHeaders(origin) });
  }

  // Method guard
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // Origin allowlist (CSRF guard)
  if (!isAllowedOrigin(origin)) {
    return json({ error: 'origin_not_allowed' }, 403);
  }
  const hdrs = corsHeaders(origin);

  // Service-role Supabase client
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Fetch daily salt
  const { data: secretRow, error: saltErr } = await supa
    .from('research_secrets')
    .select('value')
    .eq('key', 'daily_research_salt')
    .maybeSingle();

  if (saltErr || !secretRow) {
    await reportError(saltErr ?? new Error('salt_missing'), { fn: 'public-research-submit', req });
    return json({ error: 'salt_missing' }, 500, hdrs);
  }
  const salt: string = secretRow.value;

  // Client IP + User-Agent hashing
  const clientIp = extractClientIp(req);
  const userAgent = req.headers.get('user-agent') ?? '';
  const [ipHash, userAgentHash] = await Promise.all([
    sha256Hex(clientIp + salt),
    sha256Hex(userAgent + salt),
  ]);

  // Parse and validate body
  let body: RequestBody;
  try {
    const raw = await req.json();
    if (!isValidBody(raw)) {
      return json({ error: 'invalid_body' }, 400, hdrs);
    }
    body = raw;
  } catch {
    return json({ error: 'invalid_body' }, 400, hdrs);
  }

  const {
    slug,
    version,
    source = 'direct',
    answers,
    honeypot,
    contactEmail,
    contactWindowHe,
  } = body;

  // Invoke RPC — all rate-limit + circuit-breaker logic lives in Postgres
  const { data: responseId, error: rpcErr } = await supa.rpc(
    'submit_public_research_response',
    {
      p_slug: slug,
      p_version: version,
      p_source: source,
      p_ip_hash: ipHash,
      p_user_agent_hash: userAgentHash,
      p_answers: answers,
      p_honeypot: honeypot,
      p_contact_email: contactEmail ?? null,
      p_contact_window_he: contactWindowHe ?? null,
    },
  );

  if (rpcErr) {
    // Log only non-PII fields
    console.warn('[public-research-submit] rpc error', { slug, source, code: rpcErr.message });
    const mapped = mapRpcError(rpcErr.message);
    return json(mapped.body, mapped.status, hdrs);
  }

  return json({ responseId }, 200, hdrs);
}));
