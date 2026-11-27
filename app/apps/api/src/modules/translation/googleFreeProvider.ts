// Keyless translation through Google's public `translate_a/single` endpoint
// (the one the web widget uses). It needs no key, costs nothing and detects
// the source language, which the same-language checks of the callers rely on.
// Trade-off: the endpoint is undocumented and may change without notice; an
// official provider replaces it before general availability (D-63/D-65, TD-75).
//
// When Google refuses or keeps failing, one attempt goes to MyMemory's keyless
// API, so a burst still produces translations instead of an all-skipped batch.
//
// Ported from `supabase/functions/_shared/translation/googlefree.ts`.

import type { ProviderInput, ProviderResult, TranslationProvider } from './translationProvider';

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const MODEL_GOOGLE = 'google-translate-web';
const MODEL_MYMEMORY = 'mymemory-free';
/** MyMemory's keyless tier refuses longer queries. */
const MYMEMORY_MAX_CHARS = 500;
/** Attempts against Google before falling back. */
const GOOGLE_ATTEMPTS = 4;
/** Wait before the second attempt; doubled for each one after (0.7s, 1.4s, 2.8s). */
const GOOGLE_BACKOFF_MS = 700;
/** Statuses that mean "try again": rate limit and upstream failures. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
/** How much of an upstream error body is kept in an error message. */
const DETAIL_CHARS = 300;

/** This endpoint still uses the legacy `iw` tag for Hebrew; the other targets map as they are. */
const TARGET_ALIASES: Readonly<Record<string, string>> = { he: 'iw' };
/**
 * Legacy tags the endpoint reports for a detected source, back to BCP-47.
 * Without this, Hebrew text for a Hebrew reader would look like another
 * language and be "translated" and cached for nothing.
 */
const SOURCE_ALIASES: Readonly<Record<string, string>> = { iw: 'he', jw: 'jv', in: 'id' };

function targetCode(tag: string): string {
  const base = tag.toLowerCase().split('-')[0] as string;
  return TARGET_ALIASES[base] ?? base;
}

/** Response shape: `[ [ [translatedSegment, sourceSegment, ...], ... ], null, detectedSource, ... ]`. */
export function parseGoogleAnswer(raw: string): ProviderResult {
  const outer = JSON.parse(raw) as [unknown, unknown, unknown?];
  const segments = outer[0];
  if (!Array.isArray(segments)) throw new Error('google-free returned no segments');
  const translated = segments.map((segment: unknown) => (Array.isArray(segment) ? String(segment[0] ?? '') : '')).join('');
  if (translated.length === 0) throw new Error('google-free returned empty translation');
  const detected = typeof outer[2] === 'string' ? (SOURCE_ALIASES[outer[2].toLowerCase()] ?? outer[2]) : null;
  return { translatedText: translated, detectedSourceLanguage: detected, confidence: null, model: MODEL_GOOGLE };
}

/** MyMemory reports no reliable source language, so it is left null and the callers compare the texts instead. */
export function parseMyMemoryAnswer(raw: string): ProviderResult {
  const data = JSON.parse(raw) as { responseData?: { translatedText?: string }; responseStatus?: number };
  const translated = (data.responseData?.translatedText || '').trim();
  if (!translated || (data.responseStatus != null && data.responseStatus !== 200)) {
    throw new Error(`mymemory status ${data.responseStatus ?? 'unknown'}`);
  }
  return { translatedText: translated, detectedSourceLanguage: null, confidence: null, model: MODEL_MYMEMORY };
}

export interface GoogleFreeProviderOptions {
  readonly fetch?: typeof fetch;
  /** Waits between attempts; replaced in tests so they do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Receives the reason Google failed before the fallback is tried. */
  readonly onFallback?: (detail: string) => void;
}

export class GoogleFreeProvider implements TranslationProvider {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onFallback: (detail: string) => void;

  constructor(options: GoogleFreeProviderOptions = {}) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onFallback = options.onFallback ?? (() => undefined);
  }

  async translate(input: ProviderInput): Promise<ProviderResult> {
    try {
      return await this.askGoogle(input);
    } catch (error) {
      this.onFallback((error instanceof Error ? error.message : String(error)).slice(0, DETAIL_CHARS));
      return this.askMyMemory(input);
    }
  }

  /** The text goes in the body, not the URL, so a long post is not cut by a URL length limit. */
  private async askGoogle(input: ProviderInput): Promise<ProviderResult> {
    const query = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetCode(input.targetLanguage), dt: 't' });
    const body = new URLSearchParams({ q: input.text }).toString();
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetch(`${GOOGLE_ENDPOINT}?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (response.ok) return parseGoogleAnswer(await response.text());
      const detail = (await response.text()).slice(0, DETAIL_CHARS);
      const isLastAttempt = attempt === GOOGLE_ATTEMPTS - 1;
      if (!RETRYABLE_STATUSES.has(response.status) || isLastAttempt) {
        throw new Error(`google-free http ${response.status}: ${detail}`);
      }
      await this.sleep(GOOGLE_BACKOFF_MS * 2 ** attempt);
    }
  }

  private async askMyMemory(input: ProviderInput): Promise<ProviderResult> {
    const source = input.sourceHint ? targetCode(input.sourceHint) : 'Autodetect';
    const query = new URLSearchParams({
      q: input.text.slice(0, MYMEMORY_MAX_CHARS),
      langpair: `${source}|${targetCode(input.targetLanguage)}`,
    });
    const response = await this.fetch(`${MYMEMORY_ENDPOINT}?${query.toString()}`);
    if (!response.ok) throw new Error(`mymemory http ${response.status}: ${(await response.text()).slice(0, DETAIL_CHARS)}`);
    return parseMyMemoryAnswer(await response.text());
  }
}
