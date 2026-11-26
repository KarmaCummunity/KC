// A visitor answers a public research survey (FR-RESEARCH-002). The page has
// no account, so this is the only write a signed-out caller can make: the
// origin allowlist is its cross-site guard, and the visitor's address and
// user agent are stored only as hashes with the daily salt (rotated in the
// database, so hashes cannot be linked across days). The database function
// `submit_public_research_response` owns the honeypot, the per-visitor limits
// and the circuit breaker.
//
// Ported from `supabase/functions/public-research-submit/handler.ts`: same
// input, same answers, same rules.

import { createHash } from 'node:crypto';
import type { FunctionAnswer } from '../../platform/ports/hostedFunction';

/** The arguments of `submit_public_research_response`; every value is already hashed or validated. */
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

/** What the server knows about the visitor's request. */
export interface ResearchVisitor {
  readonly origin: string | undefined;
  readonly clientAddress: string;
  readonly userAgent: string;
}

export interface ResearchDeps {
  /** True when a browser page on `origin` may submit. */
  readonly isAllowedOrigin: (origin: string) => boolean;
  /** Calls `get_research_salt()`; rejects when the database cannot answer. */
  readonly getSalt: () => Promise<string>;
  /** Calls `submit_public_research_response`; resolves to the response id, rejects with the database error. */
  readonly submit: (args: SubmitArgs) => Promise<string>;
  /** Receives an infrastructure failure (for the log); the answer never carries its cause. */
  readonly report: (error: unknown) => void;
}

interface SubmissionBody {
  slug: string;
  version: number;
  source?: string;
  answers: Record<string, unknown>;
  honeypot: string;
  contactEmail?: string;
  contactWindowHe?: string;
}

/** True when the body has the fields the database function needs, with the right primitive types. */
function isValidBody(body: unknown): body is SubmissionBody {
  if (!body || typeof body !== 'object') return false;
  const fields = body as Record<string, unknown>;
  return (
    typeof fields.slug === 'string' &&
    fields.slug !== '' &&
    typeof fields.version === 'number' &&
    typeof fields.answers === 'object' &&
    fields.answers !== null &&
    !Array.isArray(fields.answers) &&
    typeof fields.honeypot === 'string'
  );
}

/** Hex SHA-256 of `value` followed by the salt: the only form in which a visitor's trace is stored. */
function saltedHash(value: string, salt: string): string {
  return createHash('sha256').update(value + salt).digest('hex');
}

/** Maps a database refusal (the message of the raised exception) to the function's answer. */
export function mapRpcError(message: string): FunctionAnswer {
  for (const period of ['minute', 'hour', 'day']) {
    if (message.includes(`rate_limited_${period}`)) return { status: 429, body: { error: 'rate_limited', period } };
  }
  if (message.includes('research_circuit_open')) return { status: 503, body: { error: 'circuit_open' } };
  if (message.includes('survey_not_found_or_version_mismatch')) return { status: 400, body: { error: 'survey_not_found' } };
  if (message.includes('invalid_input')) return { status: 400, body: { error: 'invalid_body' } };
  return { status: 500, body: { error: 'internal' } };
}

/**
 * Stores one survey response.
 * @returns `200 { responseId }`, or the refusal: `400 invalid_body | survey_not_found`,
 *   `403 origin_not_allowed`, `429 rate_limited` (with the period), `500 salt_missing | internal`,
 *   `503 circuit_open`.
 */
export async function submitResearchResponse(body: unknown, visitor: ResearchVisitor, deps: ResearchDeps): Promise<FunctionAnswer> {
  // The origin allowlist is the cross-site guard of this anonymous write; a request without an origin is refused too.
  if (!visitor.origin || !deps.isAllowedOrigin(visitor.origin)) return { status: 403, body: { error: 'origin_not_allowed' } };
  if (!isValidBody(body)) return { status: 400, body: { error: 'invalid_body' } };

  let salt: string;
  try {
    salt = await deps.getSalt();
  } catch (error) {
    deps.report(error);
    return { status: 500, body: { error: 'salt_missing' } };
  }

  try {
    const responseId = await deps.submit({
      p_slug: body.slug,
      p_version: body.version,
      p_source: body.source ?? 'direct',
      p_ip_hash: saltedHash(visitor.clientAddress, salt),
      p_user_agent_hash: saltedHash(visitor.userAgent, salt),
      p_answers: body.answers,
      p_honeypot: body.honeypot,
      p_contact_email: body.contactEmail ?? null,
      p_contact_window_he: body.contactWindowHe ?? null,
    });
    return { status: 200, body: { responseId } };
  } catch (error) {
    const mapped = mapRpcError(error instanceof Error ? error.message : '');
    // Only unexpected failures are worth a report; limits and bad input are normal traffic.
    if (mapped.status === 500) deps.report(error);
    return mapped;
  }
}
