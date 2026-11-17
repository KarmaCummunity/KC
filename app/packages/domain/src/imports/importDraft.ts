// The draft the extract-external-post Edge Function returns, as the app reads it (FR-IMPORT-006,
// FR-IMPORT-007, ADR-008). The app never trusts the wire: `parseImportDraft` turns any answer into
// a well-formed draft, and anything it cannot read becomes the manual route.
import {
  IMPORT_DIRECTIONS, IMPORT_REJECT_REASONS, IMPORT_TIME_KINDS, IMPORT_TIME_PERIODS,
  type ExtractedPost, type ExtractedTimeHint, type ImportRouting,
} from './importTypes';

export const IMPORT_CHANNELS = ['share', 'paste'] as const;
export type ImportChannel = (typeof IMPORT_CHANNELS)[number];

/** Where the member says the text came from; a label only, `unknown` when they do not say. */
export const IMPORT_SOURCE_PLATFORMS = ['whatsapp', 'facebook', 'yad2', 'other', 'unknown'] as const;
export type ImportSourcePlatform = (typeof IMPORT_SOURCE_PLATFORMS)[number];

export type ImportPlaceLevel = 'city' | 'street' | 'junction';

export interface ImportPlaceCandidate {
  readonly level: ImportPlaceLevel;
  readonly placeId: string;
  readonly nameHe: string;
  readonly cityId: string | null;
  readonly score: number;
  readonly margin: number;
}

/** `picked`: one clear match, to be confirmed; `suggest`: choose among the suggestions; `none`: nothing close. */
export interface ImportResolvedPlace {
  readonly status: 'picked' | 'suggest' | 'none';
  readonly picked: ImportPlaceCandidate | null;
  readonly suggestions: readonly ImportPlaceCandidate[];
}

export interface ImportResolvedTime {
  readonly at: Date | null;
  /** The Israel calendar day, `YYYY-MM-DD`. */
  readonly dateIso: string | null;
  readonly recurringWeekdays: readonly number[];
  /** The hour was written without a part-of-day word; show it to confirm. */
  readonly ambiguousHour: boolean;
  readonly dropped: 'past' | 'invalid' | null;
}

export interface ImportDraft {
  /** The attempt's id; null when the function refused before running (switched off, a limit). */
  readonly importId: string | null;
  readonly routing: ImportRouting;
  /** Why the draft is what it is (ok, not_a_post, rejected, provider_failed, rate_limited, disabled …). */
  readonly reason: string;
  readonly confidence: number;
  readonly extraction: ExtractedPost | null;
  readonly city: ImportResolvedPlace | null;
  readonly street: ImportResolvedPlace | null;
  readonly ride: {
    readonly origin: ImportResolvedPlace;
    readonly destination: ImportResolvedPlace;
    readonly meetings: readonly ImportResolvedPlace[];
  } | null;
  readonly time: ImportResolvedTime | null;
  /** Fields to highlight for the member to confirm. */
  readonly confirmFields: readonly string[];
  /** What the scrub removed, for the "contact details were removed" notice. */
  readonly removed: { readonly phone: number; readonly email: number; readonly id: number; readonly url: number } | null;
  readonly truncated: boolean;
}

/** The empty draft: nothing extracted, the member fills the create form themselves. */
export function manualImportDraft(reason: string): ImportDraft {
  return {
    importId: null, routing: 'manual', reason, confidence: 0, extraction: null, city: null, street: null,
    ride: null, time: null, confirmFields: [], removed: null, truncated: false,
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function parseCandidate(raw: unknown): ImportPlaceCandidate | null {
  if (!isObject(raw)) return null;
  const level = oneOf(raw.level, ['city', 'street', 'junction'] as const);
  const placeId = str(raw.placeId);
  if (!level || !placeId) return null;
  return { level, placeId, nameHe: str(raw.nameHe) ?? '', cityId: str(raw.cityId), score: num(raw.score), margin: num(raw.margin) };
}

function parsePlace(raw: unknown): ImportResolvedPlace | null {
  if (!isObject(raw)) return null;
  const status = oneOf(raw.status, ['picked', 'suggest', 'none'] as const);
  if (!status) return null;
  const picked = parseCandidate(raw.picked);
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : []).map(parseCandidate).filter((c): c is ImportPlaceCandidate => c !== null);
  // A "picked" place with no readable candidate is no pick at all.
  return status === 'picked' && !picked ? { status: 'none', picked: null, suggestions } : { status, picked, suggestions };
}

function parseTimeHint(raw: unknown): ExtractedTimeHint {
  const t = isObject(raw) ? raw : {};
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  return {
    kind: oneOf(t.kind, IMPORT_TIME_KINDS) ?? 'none', dayOffset: int(t.dayOffset), weekday: int(t.weekday), month: int(t.month),
    dayOfMonth: int(t.dayOfMonth), timeHhmm: str(t.timeHhmm), timePeriod: oneOf(t.timePeriod, IMPORT_TIME_PERIODS),
    recurringWeekdays: Array.isArray(t.recurringWeekdays) ? t.recurringWeekdays.filter((d): d is number => Number.isInteger(d)) : [],
  };
}

function parseExtraction(raw: unknown): ExtractedPost | null {
  if (!isObject(raw) || typeof raw.isPost !== 'boolean') return null;
  const place = isObject(raw.place) ? raw.place : {};
  const ride = isObject(raw.ride) ? raw.ride : null;
  const confidence = isObject(raw.confidence) ? raw.confidence : {};
  const details = isObject(raw.details)
    ? Object.fromEntries(Object.entries(raw.details).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) as Record<string, string | number | boolean>
    : {};
  return {
    isPost: raw.isPost, rejectReason: oneOf(raw.rejectReason, IMPORT_REJECT_REASONS),
    direction: oneOf(raw.direction, IMPORT_DIRECTIONS) ?? 'unknown', worldSlug: str(raw.worldSlug), subcategory: str(raw.subcategory),
    title: str(raw.title), description: str(raw.description),
    place: { cityText: str(place.cityText), streetText: str(place.streetText), neighborhoodText: str(place.neighborhoodText) },
    time: parseTimeHint(raw.time),
    ride: ride ? { originText: str(ride.originText), destinationText: str(ride.destinationText), meetingTexts: strings(ride.meetingTexts), seats: typeof ride.seats === 'number' ? ride.seats : null } : null,
    details, language: str(raw.language),
    confidence: { overall: num(confidence.overall), perField: isObject(confidence.perField) ? Object.fromEntries(Object.entries(confidence.perField).map(([k, v]) => [k, num(v)])) : {} },
  };
}

function parseTime(raw: unknown): ImportResolvedTime | null {
  if (!isObject(raw)) return null;
  const at = typeof raw.at === 'string' ? new Date(raw.at) : null;
  return {
    at: at && !Number.isNaN(at.getTime()) ? at : null, dateIso: str(raw.dateIso),
    recurringWeekdays: Array.isArray(raw.recurringWeekdays) ? raw.recurringWeekdays.filter((d): d is number => Number.isInteger(d)) : [],
    ambiguousHour: raw.ambiguousHour === true, dropped: oneOf(raw.dropped, ['past', 'invalid'] as const),
  };
}

function parseRide(raw: unknown): ImportDraft['ride'] {
  if (!isObject(raw)) return null;
  const origin = parsePlace(raw.origin);
  const destination = parsePlace(raw.destination);
  if (!origin || !destination) return null;
  return { origin, destination, meetings: (Array.isArray(raw.meetings) ? raw.meetings : []).map(parsePlace).filter((p): p is ImportResolvedPlace => p !== null) };
}

function parseRemoved(raw: unknown): ImportDraft['removed'] {
  if (!isObject(raw)) return null;
  return { phone: num(raw.phone), email: num(raw.email), id: num(raw.id), url: num(raw.url) };
}

/**
 * Read the function's answer. A body that is not a draft, or has no routing, is the manual route:
 * the member always keeps a way to create the post by hand (FR-IMPORT-006 AC4).
 */
export function parseImportDraft(raw: unknown): ImportDraft {
  if (!isObject(raw)) return manualImportDraft('invalid_response');
  const routing = oneOf(raw.routing, ['ready', 'confirm', 'manual'] as const);
  if (!routing) return manualImportDraft('invalid_response');
  const extraction = parseExtraction(raw.extraction);
  // A "ready" or "confirm" answer without an extraction has nothing to prefill.
  const usable = extraction !== null && extraction.isPost;
  return {
    importId: str(raw.importId), routing: usable ? routing : 'manual', reason: str(raw.reason) ?? 'ok', confidence: num(raw.confidence),
    extraction: usable ? extraction : null, city: parsePlace(raw.city), street: parsePlace(raw.street), ride: parseRide(raw.ride),
    time: parseTime(raw.time), confirmFields: strings(raw.confirmFields), removed: parseRemoved(raw.removed), truncated: raw.truncated === true,
  };
}
