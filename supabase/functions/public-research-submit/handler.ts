// public-research-submit — the public gateway for anonymous research surveys
// (FR-RESEARCH-002, supabase/schemas/90_research/030_public_research.sql). It checks the
// origin allowlist, hashes the visitor's address and user agent with the daily salt (the
// salt is rotated by `rotate-research-salt`, so hashes cannot be linked across days) and
// hands the response to submit_public_research_response, which owns the honeypot, the
// rate limits and the circuit breaker. It also serves the form its questions
// (get_public_research_questions is service-role only, so the page cannot read them itself).
// Anonymous callers: no credential is checked.
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';

/** The arguments of submit_public_research_response; every value is already hashed or validated. */
export interface SubmitArgs {
  p_slug: string;
  p_version: number;
  p_source: string;
  p_ip_hash: string;
  p_user_agent_hash: string;
  p_answers: Record<string, unknown>;
  p_honeypot: string;
  p_contact_email: string | null;
  p_contact_window_he: string | null;
}

export interface ResearchDeps {
  /** Calls `get_public_research_questions(slug)`; null when the survey is not active. */
  readonly loadQuestions: (slug: string) => Promise<unknown | null>;
  /** Calls `get_research_salt()`; rejects when the database cannot answer. */
  readonly getSalt: () => Promise<string>;
  /** Calls `submit_public_research_response`; resolves to the response id, rejects with the database error. */
  readonly submit: (args: SubmitArgs) => Promise<string>;
  /** Receives an infrastructure failure; the response never carries its cause. */
  readonly report: (error: unknown) => Promise<void>;
}

interface RequestBody {
  slug: string;
  version: number;
  source?: string;
  answers: Record<string, unknown>;
  honeypot: string;
  contactEmail?: string;
  contactWindowHe?: string;
}

/** A survey slug as `public.surveys` allows it. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

/** Used when no proxy header names the client, so a missing header still hashes to something. */
const LOCAL_IP_PLACEHOLDER = '127.0.0.1';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

/** Hex SHA-256 of a string. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The client address from the first proxy header that names one. */
function extractClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0].trim();
  return forwarded || req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-real-ip')?.trim() || LOCAL_IP_PLACEHOLDER;
}

/** True when the parsed JSON has the fields the RPC needs, with the right primitive types. */
function isValidBody(b: unknown): b is RequestBody {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return typeof o.slug === 'string' && o.slug !== '' &&
    typeof o.version === 'number' &&
    typeof o.answers === 'object' && o.answers !== null && !Array.isArray(o.answers) &&
    typeof o.honeypot === 'string';
}

/** Maps a database error code (the message of the raised exception) to an HTTP answer. */
export function mapRpcError(message: string): { status: number; body: Record<string, string> } {
  for (const period of ['minute', 'hour', 'day']) {
    if (message.includes(`rate_limited_${period}`)) return { status: 429, body: { error: 'rate_limited', period } };
  }
  if (message.includes('research_circuit_open')) return { status: 503, body: { error: 'circuit_open' } };
  if (message.includes('survey_not_found_or_version_mismatch')) return { status: 400, body: { error: 'survey_not_found' } };
  if (message.includes('invalid_input')) return { status: 400, body: { error: 'invalid_body' } };
  return { status: 500, body: { error: 'internal' } };
}

/** POST { action: 'questions', slug } → 200 { slug, title_he, description_he, version, questions }. */
async function answerQuestions(deps: ResearchDeps, slug: unknown, cors: Record<string, string>): Promise<Response> {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return json({ error: 'invalid_body' }, 400, cors);
  try {
    const bundle = await deps.loadQuestions(slug);
    return bundle ? json(bundle, 200, cors) : json({ error: 'survey_not_found' }, 400, cors);
  } catch (error) {
    await deps.report(error);
    return json({ error: 'internal' }, 500, cors);
  }
}

/**
 * POST { slug, version, source?, answers, honeypot, contactEmail?, contactWindowHe? } → 200 { responseId };
 * POST { action: 'questions', slug } → the form's questions.
 */
export function createResearchHandler(deps: ResearchDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') {
      return isAllowedOrigin(origin) ? new Response('ok', { status: 200, headers: corsHeaders(origin) }) : json({ error: 'origin_not_allowed' }, 403);
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    // The origin allowlist is the cross-site guard of this anonymous endpoint.
    if (!isAllowedOrigin(origin)) return json({ error: 'origin_not_allowed' }, 403);
    const cors = corsHeaders(origin);

    let body: RequestBody;
    try {
      const raw = await req.json();
      if (raw?.action === 'questions') return answerQuestions(deps, raw.slug, cors);
      if (!isValidBody(raw)) return json({ error: 'invalid_body' }, 400, cors);
      body = raw;
    } catch {
      return json({ error: 'invalid_body' }, 400, cors);
    }

    let salt: string;
    try {
      salt = await deps.getSalt();
    } catch (error) {
      await deps.report(error);
      return json({ error: 'salt_missing' }, 500, cors);
    }
    const [ipHash, userAgentHash] = await Promise.all([
      sha256Hex(extractClientIp(req) + salt),
      sha256Hex((req.headers.get('user-agent') ?? '') + salt),
    ]);

    try {
      const responseId = await deps.submit({
        p_slug: body.slug,
        p_version: body.version,
        p_source: body.source ?? 'direct',
        p_ip_hash: ipHash,
        p_user_agent_hash: userAgentHash,
        p_answers: body.answers,
        p_honeypot: body.honeypot,
        p_contact_email: body.contactEmail ?? null,
        p_contact_window_he: body.contactWindowHe ?? null,
      });
      return json({ responseId }, 200, cors);
    } catch (error) {
      const mapped = mapRpcError(error instanceof Error ? error.message : '');
      // Only unexpected failures are worth a report; limits and bad input are normal traffic.
      if (mapped.status === 500) await deps.report(error);
      return json(mapped.body, mapped.status, cors);
    }
  };
}
