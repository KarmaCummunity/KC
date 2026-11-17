// supabase/functions/extract-external-post/handler.ts
// POST { text, channel?, sourcePlatform? } — a member shares or pastes a post from outside KC and
// gets back a draft to review (FR-IMPORT-001..009, ADR-008). Logic lives here with every
// dependency injected, so it is unit-tested; index.ts only wires Supabase. The draft is never a
// post: the member reviews and publishes it through the normal create flow.

import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { extractExternalPost, fingerprintFor, type ExtractionCache, type ExtractionOutcome } from '../_shared/post-extraction/extractPost.ts';
import type { ExtractionLists } from '../_shared/post-extraction/domain/validateExtraction.ts';
import { checkLimits, DEFAULT_LIMITS, lockoutLookbackMs, type LimitConfig, type LimitReason } from '../_shared/post-extraction/limits.ts';
import type { PlaceResolver } from '../_shared/post-extraction/places.ts';
import type { PostExtractionProvider } from '../_shared/post-extraction/providerTypes.ts';
import { EXTRACTION_PROMPT_VERSION } from '../_shared/post-extraction/prompt.ts';
import type { ImportRecord, ImportStore } from '../_shared/post-extraction/store.ts';

export interface AuthedMember {
  id: string;
  /** When the account was created, from the verified token; null if unknown (fails closed). */
  createdAt: Date | null;
}

export interface HandlerDeps {
  authenticate(req: Request): Promise<AuthedMember | null>;
  /** The kill switch (FR-IMPORT-001 AC4). */
  isEnabled(): Promise<boolean>;
  store: ImportStore;
  cache: ExtractionCache;
  loadLists(): Promise<ExtractionLists>;
  provider: PostExtractionProvider;
  resolvePlace: PlaceResolver;
  now(): Date;
  limits?: LimitConfig;
  /** Sends an unexpected error to the observability reporter; injected so tests need no environment. */
  report(error: unknown, req: Request): Promise<void>;
}

/** Far above any real post: a body this long is not a shared message (the pipeline itself cuts at 4,000). */
const MAX_BODY_TEXT_CHARS = 20_000;
const CHANNELS = ['share', 'paste'] as const;
const PLATFORMS = ['whatsapp', 'facebook', 'yad2', 'other', 'unknown'] as const;

type Reason = ExtractionOutcome['reason'] | LimitReason | 'disabled';

interface Body {
  text: string;
  channel: ImportRecord['channel'];
  sourcePlatform: ImportRecord['source_platform'];
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** The request body, or null when it is not a usable import request. */
function parseBody(raw: unknown): Body | 'too_long' | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== 'string' || o.text.trim() === '') return null;
  if (o.text.length > MAX_BODY_TEXT_CHARS) return 'too_long';
  const channel = o.channel ?? 'paste';
  const platform = o.sourcePlatform ?? 'unknown';
  if (!(CHANNELS as readonly unknown[]).includes(channel) || !(PLATFORMS as readonly unknown[]).includes(platform)) return null;
  return { text: o.text, channel: channel as Body['channel'], sourcePlatform: platform as Body['sourcePlatform'] };
}

/** A manual-route answer that never reached the pipeline (switched off, or a limit). */
function refused(reason: Reason) {
  return { importId: null, routing: 'manual' as const, reason, confidence: 0, extraction: null, confirmFields: [] as string[] };
}

/** What the app gets: the draft and how sure we are, never the fingerprint or the raw text. */
function toResponse(importId: string, o: ExtractionOutcome) {
  return {
    importId, routing: o.routing, reason: o.reason, confidence: o.confidence, extraction: o.extraction,
    city: o.city, street: o.street, ride: o.ride, time: o.time, confirmFields: o.confirmFields,
    removed: o.removed, truncated: o.truncated, promptVersion: o.promptVersion, cacheHit: o.cacheHit,
  };
}

/** Start of the current UTC day: the window of the daily provider budget. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function limitReason(deps: HandlerDeps, member: AuthedMember): Promise<LimitReason | null> {
  const now = deps.now();
  const config = deps.limits ?? DEFAULT_LIMITS;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const [hour, day, calls, removals] = await Promise.all([
    deps.store.attemptsSince(member.id, ago(60 * 60 * 1000)),
    deps.store.attemptsSince(member.id, ago(24 * 60 * 60 * 1000)),
    deps.store.providerCallsSince(startOfUtcDay(now).toISOString()),
    deps.store.moderationRemovalsSince(member.id, ago(lockoutLookbackMs(config))),
  ]);
  return checkLimits(
    {
      accountCreatedAt: member.createdAt, now, attemptsLastHour: hour, attemptsLastDay: day,
      providerCallsToday: calls, moderationRemovals: removals,
    },
    config,
  );
}

/** The row kept for an attempt: no raw text, only the fingerprint and the validated extraction. */
async function toRecord(member: AuthedMember, body: Body, o: ExtractionOutcome): Promise<ImportRecord> {
  return {
    user_id: member.id, channel: body.channel, source_platform: body.sourcePlatform,
    text_fingerprint: o.fingerprint ?? await fingerprintFor(body.text),
    routing: o.routing, reason: o.reason, confidence: Math.round(o.confidence * 100) / 100,
    extraction: o.extraction, extraction_version: EXTRACTION_PROMPT_VERSION, model: o.model,
    provider_called: o.providerCalled,
  };
}

export function createHandler(deps: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') {
      return isAllowedOrigin(origin)
        ? new Response('ok', { status: 200, headers: corsHeaders(origin) })
        : json({ error: 'origin_not_allowed' }, 403);
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const headers = isAllowedOrigin(origin) ? corsHeaders(origin) : {};

    try {
      const member = await deps.authenticate(req);
      if (!member) return json({ error: 'unauthorized' }, 401, headers);
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return json({ error: 'invalid_body' }, 400, headers);
      }
      const body = parseBody(raw);
      if (body === 'too_long') return json({ error: 'text_too_long' }, 413, headers);
      if (!body) return json({ error: 'invalid_body' }, 400, headers);

      if (!await deps.isEnabled()) return json(refused('disabled'), 200, headers);
      const limited = await limitReason(deps, member);
      if (limited) return json(refused(limited), 200, headers);

      const outcome = await extractExternalPost(
        { provider: deps.provider, cache: deps.cache, resolvePlace: deps.resolvePlace, lists: await deps.loadLists(), now: deps.now },
        body.text,
      );
      const importId = await deps.store.record(await toRecord(member, body, outcome));
      return json(toResponse(importId, outcome), 200, headers);
    } catch (error) {
      await deps.report(error, req);
      return json({ error: 'internal' }, 500, headers);
    }
  };
}
