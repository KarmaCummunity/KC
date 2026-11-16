// supabase/functions/_shared/post-extraction/extractPost.ts
// The extraction pipeline of the external post import (FR-IMPORT-002..006, ADR-008): scrub,
// ONE model call, validate, resolve places and time, recalibrate, route. Pure orchestration
// over injected I/O (provider, place catalog, clock), so every branch is unit-tested. It
// never publishes and never throws for a bad input or a provider failure: the answer is then
// the manual route (FR-IMPORT-006 AC3-AC4).

import { directionCues } from './cues.ts';
import { ImportExtractionError } from './domain/ImportExtractionError.ts';
import { canonicalFingerprintText } from './domain/fingerprint.ts';
import type { ExtractedPost, ImportRouting } from './domain/importTypes.ts';
import { prepareImportText, type PreparedImportText } from './domain/prepareImportText.ts';
import {
  DEFAULT_IMPORT_THRESHOLDS,
  recalibrateConfidence,
  type ImportConfidenceThresholds,
} from './domain/recalibrateConfidence.ts';
import { resolveTimeHint, type ResolvedTime } from './domain/resolveRelativeTime.ts';
import { validateExtraction, type ExtractionLists } from './domain/validateExtraction.ts';
import { EXTRACTION_PROMPT_VERSION } from './prompt.ts';
import { decidePlace, resolveRidePlace, type PlaceResolver, type ResolvedPlace } from './places.ts';
import type { PostExtractionProvider } from './providerTypes.ts';

export interface ExtractDeps {
  provider: PostExtractionProvider;
  resolvePlace: PlaceResolver;
  lists: ExtractionLists;
  now: () => Date;
  thresholds?: ImportConfidenceThresholds;
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
  /** Canonical text to hash for the cache and the cross-post guard (FR-IMPORT-008). */
  fingerprintText: string | null;
  model: string | null;
  promptVersion: string;
}

/** Worlds whose posts are about a place: the city is always put in front of the member. */
const PLACE_BOUND_WORLDS = new Set(['items', 'food', 'housing', 'animals']);
const REQUIRED_FIELDS = ['direction', 'world', 'title'] as const;

function manual(reason: ExtractionReason, partial: Partial<ExtractionOutcome> = {}): ExtractionOutcome {
  return {
    routing: 'manual', reason, extraction: null, city: null, street: null, ride: null, time: null,
    confirmFields: [], confidence: 0, removed: null, truncated: false, fingerprintText: null,
    model: null, promptVersion: EXTRACTION_PROMPT_VERSION, ...partial,
  };
}

type Called = { extraction: ExtractedPost; model: string } | 'provider_failed' | 'invalid_result';

/** One call; an invalid contract answer is retried once (FR-IMPORT-003 AC3), a provider failure is final. */
async function callProvider(deps: ExtractDeps, prepared: PreparedImportText): Promise<Called> {
  const input = { text: prepared.text, messageAtIso: prepared.messageAt?.toISOString() ?? null, lists: deps.lists };
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await deps.provider.extract(input);
    } catch {
      return 'provider_failed';
    }
    try {
      return { extraction: validateExtraction(result.raw, deps.lists), model: result.model };
    } catch (error) {
      if (!(error instanceof ImportExtractionError)) throw error;
    }
  }
  return 'invalid_result';
}

async function resolveRide(deps: ExtractDeps, extraction: ExtractedPost): Promise<ExtractionOutcome['ride']> {
  const ride = extraction.ride;
  if (!ride) return null;
  const at = (text: string | null) => resolveRidePlace(deps.resolvePlace, text);
  const [origin, destination, ...meetings] = await Promise.all([
    at(ride.originText), at(ride.destinationText), ...ride.meetingTexts.map(at),
  ]);
  return { origin: origin!, destination: destination!, meetings };
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
  const base = { removed: prepared.removed, truncated: prepared.truncated, fingerprintText: canonicalFingerprintText(prepared.text) };

  const called = await callProvider(deps, prepared);
  if (typeof called === 'string') return manual(called, base);
  const { extraction, model } = called;
  if (!extraction.isPost) return manual('not_a_post', { ...base, extraction, model });
  if (extraction.rejectReason) return manual('rejected', { ...base, extraction, model });

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
    ...manual('ok'), ...base, routing: scored.routing, extraction, city, street, ride, time,
    confirmFields: [...scored.confirmFields], confidence: scored.overall, model,
  };
}
