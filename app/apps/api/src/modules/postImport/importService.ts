// A member shares or pastes a post from outside KC and gets back a draft to
// review (FR-IMPORT-001..009, ADR-008). The draft is never a post: the member
// reviews and publishes it through the normal create flow. Every dependency
// is injected, so the rules are unit-tested without a database or a model.
//
// Ported from `supabase/functions/extract-external-post/handler.ts`: same
// input, same answers, same rules.

import type { ExtractionLists } from '@kc/domain';
import type { FunctionAnswer } from '../../platform/ports/hostedFunction';
import { type ExtractionCache, type ExtractionOutcome, extractExternalPost, fingerprintFor } from './extractPost';
import { EXTRACTION_PROMPT_VERSION } from './extractionPrompt';
import type { PostExtractionProvider } from './extractionProvider';
import { checkLimits, DEFAULT_LIMITS, type LimitConfig, type LimitReason, lockoutLookbackMs } from './importLimits';
import type { ImportRecord, ImportStore } from './importStore';
import type { PlaceResolver } from './placeDecision';

/** The caller, as the import rules see them. */
export interface ImportMember {
  readonly id: string;
  /** When the account was created; null if unknown, which fails closed as too new. */
  readonly createdAt: Date | null;
}

export interface ImportDeps {
  /** The kill switch (FR-IMPORT-001 AC4). */
  isEnabled(): Promise<boolean>;
  readonly store: ImportStore;
  readonly cache: ExtractionCache;
  loadLists(): Promise<ExtractionLists>;
  readonly provider: PostExtractionProvider;
  readonly resolvePlace: PlaceResolver;
  now(): Date;
  readonly limits?: LimitConfig;
  /** Receives an unexpected failure (for the log); the member only sees `internal`. */
  report(error: unknown): void;
  /** Sees why the provider gave no answer (for the log). */
  readonly onProviderFailure?: (error: unknown) => void;
}

/** Far above any real post: a body this long is not a shared message (the pipeline itself cuts at 4,000). */
const MAX_BODY_TEXT_CHARS = 20_000;
const CHANNELS: readonly unknown[] = ['share', 'paste'];
const PLATFORMS: readonly unknown[] = ['whatsapp', 'facebook', 'yad2', 'other', 'unknown'];
const HOUR_MS = 60 * 60 * 1000;

type Reason = ExtractionOutcome['reason'] | LimitReason | 'disabled';

interface ImportRequest {
  readonly text: string;
  readonly channel: ImportRecord['channel'];
  readonly sourcePlatform: ImportRecord['source_platform'];
}

/** The request, `too_long`, or null when it is not a usable import request. */
function parseRequest(body: unknown): ImportRequest | 'too_long' | null {
  if (!body || typeof body !== 'object') return null;
  const fields = body as Record<string, unknown>;
  if (typeof fields.text !== 'string' || fields.text.trim() === '') return null;
  if (fields.text.length > MAX_BODY_TEXT_CHARS) return 'too_long';
  const channel = fields.channel ?? 'paste';
  const platform = fields.sourcePlatform ?? 'unknown';
  if (!CHANNELS.includes(channel) || !PLATFORMS.includes(platform)) return null;
  return { text: fields.text, channel: channel as ImportRequest['channel'], sourcePlatform: platform as ImportRequest['sourcePlatform'] };
}

/** A manual-route answer that never reached the pipeline (switched off, or a limit). */
function refused(reason: Reason): FunctionAnswer {
  return { status: 200, body: { importId: null, routing: 'manual', reason, confidence: 0, extraction: null, confirmFields: [], duplicatePostId: null } };
}

/** What the app gets: the draft and how sure the server is, never the fingerprint or the raw text. */
function draftOf(importId: string, outcome: ExtractionOutcome, duplicatePostId: string | null) {
  return {
    importId,
    routing: outcome.routing,
    reason: outcome.reason,
    confidence: outcome.confidence,
    extraction: outcome.extraction,
    city: outcome.city,
    street: outcome.street,
    ride: outcome.ride,
    time: outcome.time,
    confirmFields: outcome.confirmFields,
    removed: outcome.removed,
    truncated: outcome.truncated,
    promptVersion: outcome.promptVersion,
    cacheHit: outcome.cacheHit,
    duplicatePostId,
  };
}

/** Start of the current UTC day: the window of the daily provider budget. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The limit that stops this member right now, or null. */
async function limitReason(deps: ImportDeps, member: ImportMember): Promise<LimitReason | null> {
  const now = deps.now();
  const config = deps.limits ?? DEFAULT_LIMITS;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const [attemptsLastHour, attemptsLastDay, providerCallsToday, moderationRemovals] = await Promise.all([
    deps.store.attemptsSince(member.id, ago(HOUR_MS)),
    deps.store.attemptsSince(member.id, ago(24 * HOUR_MS)),
    deps.store.providerCallsSince(startOfUtcDay(now).toISOString()),
    deps.store.moderationRemovalsSince(member.id, ago(lockoutLookbackMs(config))),
  ]);
  return checkLimits({ accountCreatedAt: member.createdAt, now, attemptsLastHour, attemptsLastDay, providerCallsToday, moderationRemovals }, config);
}

/**
 * The cross-post guard (FR-IMPORT-008 AC1): the member's open post this draft
 * repeats, compared on the extracted title and description (what would become
 * the post), or null. Only a post draft is checked; a manual route has nothing
 * to compare.
 */
function repeatedOpenPost(deps: ImportDeps, member: ImportMember, outcome: ExtractionOutcome): Promise<string | null> {
  const extraction = outcome.extraction;
  if (!extraction?.isPost) return Promise.resolve(null);
  const text = [extraction.title, extraction.description].filter((part): part is string => !!part).join(' ').trim();
  return text === '' ? Promise.resolve(null) : deps.store.similarOpenPost(member.id, text);
}

/** The row kept for an attempt: no raw text, only the fingerprint and the validated extraction. */
function recordOf(member: ImportMember, request: ImportRequest, outcome: ExtractionOutcome, duplicatePostId: string | null): ImportRecord {
  return {
    user_id: member.id,
    channel: request.channel,
    source_platform: request.sourcePlatform,
    text_fingerprint: outcome.fingerprint ?? fingerprintFor(request.text),
    routing: outcome.routing,
    reason: outcome.reason,
    // The column holds two decimals.
    confidence: Math.round(outcome.confidence * 100) / 100,
    extraction: outcome.extraction,
    extraction_version: EXTRACTION_PROMPT_VERSION,
    model: outcome.model,
    provider_called: outcome.providerCalled,
    duplicate_post_id: duplicatePostId,
  };
}

/**
 * Turns a shared text into a draft.
 * @param member The signed-in caller, or null. The member always comes from the token, never from the body.
 * @returns `200` with the draft (a refusal the server chose, such as a limit, is a draft on the manual route),
 *   or `400 invalid_body`, `401 unauthorized`, `413 text_too_long`, `500 internal`.
 */
export async function importExternalPost(member: ImportMember | null, body: unknown, deps: ImportDeps): Promise<FunctionAnswer> {
  if (!member) return { status: 401, body: { error: 'unauthorized' } };
  const request = parseRequest(body);
  if (request === 'too_long') return { status: 413, body: { error: 'text_too_long' } };
  if (!request) return { status: 400, body: { error: 'invalid_body' } };

  try {
    if (!(await deps.isEnabled())) return refused('disabled');
    const limited = await limitReason(deps, member);
    if (limited) return refused(limited);

    const outcome = await extractExternalPost(
      { provider: deps.provider, cache: deps.cache, resolvePlace: deps.resolvePlace, lists: await deps.loadLists(), now: () => deps.now(), onProviderFailure: deps.onProviderFailure },
      request.text,
    );
    const duplicatePostId = await repeatedOpenPost(deps, member, outcome);
    const importId = await deps.store.record(recordOf(member, request, outcome, duplicatePostId));
    return { status: 200, body: draftOf(importId, outcome, duplicatePostId) };
  } catch (error) {
    deps.report(error);
    return { status: 500, body: { error: 'internal' } };
  }
}
