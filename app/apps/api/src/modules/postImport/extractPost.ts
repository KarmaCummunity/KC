// The extraction pipeline of the external post import (FR-IMPORT-002..006,
// ADR-008): scrub, ONE model call, validate, resolve places and time,
// recalibrate, route. Pure orchestration over injected I/O (provider, place
// catalog, clock), so every branch is unit-tested. It never publishes and
// never throws for a bad input or a provider failure: the answer is then the
// manual route (FR-IMPORT-006 AC3-AC4).
//
// Ported from `supabase/functions/_shared/post-extraction/extractPost.ts`. The
// pure stages it calls are `@kc/domain`'s own: the Edge Function had to keep a
// generated copy of them, this server imports them.

import { createHash } from 'node:crypto';
import {
  canonicalFingerprintText,
  DEFAULT_IMPORT_THRESHOLDS,
  type ExtractedPost,
  type ExtractionLists,
  type ImportConfidenceThresholds,
  ImportExtractionError,
  type ImportRouting,
  type PreparedImportText,
  prepareImportText,
  recalibrateConfidence,
  type ResolvedTime,
  resolveTimeHint,
  validateExtraction,
} from '@kc/domain';
import { directionCues } from './directionCues';
import { EXTRACTION_PROMPT_VERSION } from './extractionPrompt';
import type { PostExtractionProvider } from './extractionProvider';
import { decidePlace, type PlaceResolver, type ResolvedPlace, resolveRidePlace } from './placeDecision';

/** SHA-256 hex of the canonical text (FR-IMPORT-008 AC1): the key of the cache and of the cross-post guard. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Day cache of validated model answers by fingerprint (FR-IMPORT-008 AC2). Failures here never fail an extraction. */
export interface ExtractionCache {
  get(fingerprint: string, version: string): Promise<unknown | null>;
  put(fingerprint: string, version: string, result: unknown): Promise<void>;
}

export interface ExtractDeps {
  provider: PostExtractionProvider;
  cache?: ExtractionCache;
  resolvePlace: PlaceResolver;
  lists: ExtractionLists;
  now: () => Date;
  thresholds?: ImportConfidenceThresholds;
  /** Sees why the provider gave no answer (for the log); the member only gets the manual route. */
  onProviderFailure?: (error: unknown) => void;
}

export type ExtractionReason =
  | 'ok' | 'empty_text' | 'not_a_post' | 'rejected' | 'provider_failed' | 'invalid_result';

export interface ExtractionOutcome {
  routing: ImportRouting;
  reason: ExtractionReason;
  extraction: ExtractedPost | null;
  city: ResolvedPlace | null;
  street: ResolvedPlace | null;
  ride: { origin: ResolvedPlace; destination: ResolvedPlace; meetings: ResolvedPlace[] } | null;
  time: ResolvedTime | null;
  /** Fields to highlight in the draft for the member to confirm. */
  confirmFields: string[];
  confidence: number;
  /** What the scrub removed, for the "contact details were removed" notice (FR-IMPORT-002 AC3). */
  removed: PreparedImportText['removed'] | null;
  truncated: boolean;
  /** SHA-256 hex of the canonical scrubbed text: the key of the cache and the cross-post guard (FR-IMPORT-008). */
  fingerprint: string | null;
  model: string | null;
  /** A model call was made; the daily budget counts these. */
  providerCalled: boolean;
  /** The answer came from the day cache. */
  cacheHit: boolean;
  promptVersion: string;
}

/** Worlds whose posts are about a place: the city is always put in front of the member. */
const PLACE_BOUND_WORLDS = new Set(['items', 'food', 'housing', 'animals']);
const REQUIRED_FIELDS = ['direction', 'world', 'title'] as const;

function manual(reason: ExtractionReason, partial: Partial<ExtractionOutcome> = {}): ExtractionOutcome {
  return {
    routing: 'manual', reason, extraction: null, city: null, street: null, ride: null, time: null,
    confirmFields: [], confidence: 0, removed: null, truncated: false, fingerprint: null,
    model: null, providerCalled: false, cacheHit: false, promptVersion: EXTRACTION_PROMPT_VERSION, ...partial,
  };
}

type Called =
  | { extraction: ExtractedPost; model: string; providerCalled: boolean; cacheHit: boolean }
  | { failure: 'provider_failed' | 'invalid_result'; providerCalled: boolean };

/** A cached answer, validated again; a missing, broken or unreadable entry is simply a miss. */
async function fromCache(deps: ExtractDeps, fingerprint: string): Promise<ExtractedPost | null> {
  if (!deps.cache) return null;
  try {
    const hit = await deps.cache.get(fingerprint, EXTRACTION_PROMPT_VERSION);
    return hit ? validateExtraction(hit, deps.lists) : null;
  } catch {
    return null;
  }
}

/** One call; an invalid contract answer is retried once (FR-IMPORT-003 AC3), a provider failure is final. */
async function callProvider(deps: ExtractDeps, prepared: PreparedImportText, fingerprint: string): Promise<Called> {
  const cached = await fromCache(deps, fingerprint);
  if (cached) return { extraction: cached, model: 'cache', providerCalled: false, cacheHit: true };

  const input = { text: prepared.text, messageAtIso: prepared.messageAt?.toISOString() ?? null, lists: deps.lists };
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await deps.provider.extract(input);
    } catch (error) {
      deps.onProviderFailure?.(error);
      return { failure: 'provider_failed', providerCalled: true };
    }
    try {
      const extraction = validateExtraction(result.raw, deps.lists);
      // Best effort: the member's answer must not wait on, or fail with, the cache.
      await deps.cache?.put(fingerprint, EXTRACTION_PROMPT_VERSION, result.raw).catch(() => undefined);
      return { extraction, model: result.model, providerCalled: true, cacheHit: false };
    } catch (error) {
      if (!(error instanceof ImportExtractionError)) throw error;
    }
  }
  return { failure: 'invalid_result', providerCalled: true };
}

async function resolveRide(deps: ExtractDeps, extraction: ExtractedPost): Promise<ExtractionOutcome['ride']> {
  const ride = extraction.ride;
  if (!ride) return null;
  const at = (text: string | null) => resolveRidePlace(deps.resolvePlace, text);
  const [origin, destination, meetings] = await Promise.all([at(ride.originText), at(ride.destinationText), Promise.all(ride.meetingTexts.map(at))]);
  return { origin, destination, meetings };
}

/** The fingerprint of any raw text, also one with nothing left to extract (the attempt is still recorded). */
export function fingerprintFor(rawText: string): string {
  try {
    return sha256Hex(canonicalFingerprintText(prepareImportText(rawText).text));
  } catch (error) {
    if (error instanceof ImportExtractionError) return sha256Hex('');
    throw error;
  }
}

/** Run the pipeline for one shared text. */
export async function extractExternalPost(deps: ExtractDeps, rawText: string): Promise<ExtractionOutcome> {
  let prepared: PreparedImportText;
  try {
    prepared = prepareImportText(rawText);
  } catch (error) {
    if (error instanceof ImportExtractionError) return manual('empty_text');
    throw error;
  }
  const fingerprint = sha256Hex(canonicalFingerprintText(prepared.text));
  const base = { removed: prepared.removed, truncated: prepared.truncated, fingerprint };

  const called = await callProvider(deps, prepared, fingerprint);
  if ('failure' in called) return manual(called.failure, { ...base, providerCalled: called.providerCalled });
  const { extraction, model, providerCalled, cacheHit } = called;
  const answer = { ...base, extraction, model, providerCalled, cacheHit };
  if (!extraction.isPost) return manual('not_a_post', answer);
  if (extraction.rejectReason) return manual('rejected', answer);

  const city = extraction.place.cityText ? decidePlace('city', await deps.resolvePlace('city', extraction.place.cityText, null)) : null;
  const street = extraction.place.streetText && city?.picked
    ? decidePlace('street', await deps.resolvePlace('street', extraction.place.streetText, city.picked.placeId))
    : null;
  const ride = await resolveRide(deps, extraction);
  const time = resolveTimeHint(extraction.time, { messageAt: prepared.messageAt, now: deps.now() });

  const confirmFields = [
    ...(PLACE_BOUND_WORLDS.has(extraction.worldSlug ?? '') ? ['city'] : []),
    ...(street?.picked ? ['street'] : []),
    ...(ride ? ['origin', 'destination'] : []),
    ...(time.ambiguousHour ? ['time'] : []),
  ];
  const cues = directionCues(prepared.text);
  const scored = recalibrateConfidence(
    extraction,
    {
      required: REQUIRED_FIELDS,
      directionCue: extraction.direction === 'offer' ? cues.offer : extraction.direction === 'request' ? cues.request : false,
      conflictingCues: cues.offer && cues.request,
      textLength: prepared.text.length,
      place: {},
      autoPickedFields: confirmFields,
    },
    deps.thresholds ?? DEFAULT_IMPORT_THRESHOLDS,
  );
  return {
    ...manual('ok'), ...answer, routing: scored.routing, city, street, ride, time,
    confirmFields: [...scored.confirmFields], confidence: scored.overall,
  };
}
