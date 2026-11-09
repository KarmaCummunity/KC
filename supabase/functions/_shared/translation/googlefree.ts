// supabase/functions/_shared/translation/googlefree.ts
// Keyless, no-billing translation via Google's public `translate_a/single`
// endpoint (the same one the web widget uses). Chosen because the free Gemini
// tier is not universally available — some projects/regions return
// `free_tier_requests limit: 0` (TD-75) — and the PM directive is "free models
// only, no billing". This endpoint needs no API key and auto-detects the source
// language, which the same-language short-circuit in the callers relies on.
// Trade-off: it is an undocumented endpoint (ToS-gray, may change without
// notice); revisit for an official/DPA provider before GA (D-63/D-65, TD-75).
// Used by the KC `translate` Edge Function.
//
// When Google returns 429 / transient failure, fall back once to MyMemory's
// keyless API so local/dev bursts still produce translations instead of a
// silent all-`skipped` batch (which the client previously treated as terminal).

import type { ProviderInput, ProviderResult, TranslationProvider } from './provider.ts';

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const MODEL_GOOGLE = 'google-translate-web';
const MODEL_MYMEMORY = 'mymemory-free';

// Google uses the legacy `iw` tag for Hebrew on this endpoint; normalise a few
// BCP-47 targets to what the endpoint expects. Other supported targets
// (en/ar/ru) map 1:1, so only the base language is forwarded.
const TARGET_ALIASES: Record<string, string> = { he: 'iw' };

function targetCode(tag: string): string {
  const base = tag.toLowerCase().split('-')[0];
  return TARGET_ALIASES[base] ?? base;
}

// Reverse map for the DETECTED source code so the callers' same-language
// short-circuit sees BCP-47 (`he`), not Google's legacy `iw`. Without this,
// Hebrew content targeting `he` would fail the source==target check and get
// pointlessly re-"translated" and cached.
const SOURCE_ALIASES: Record<string, string> = { iw: 'he', jw: 'jv', in: 'id' };

function normaliseSource(code: string): string {
  return SOURCE_ALIASES[code.toLowerCase()] ?? code;
}

function buildGoogleUrl(input: ProviderInput): string {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetCode(input.targetLanguage),
    dt: 't',
  });
  return `${GOOGLE_ENDPOINT}?${params.toString()}`;
}

// Response shape: [ [ [translatedSeg, sourceSeg, ...], ... ], null, detectedSrc, ... ].
type Segment = [string, string, ...unknown[]];
function parseGoogle(raw: string): ProviderResult {
  const outer = JSON.parse(raw) as [Segment[] | null, unknown, string?, ...unknown[]];
  const segments = outer[0];
  if (!Array.isArray(segments)) throw new Error('google-free returned no segments');
  const translated = segments.map((s) => (Array.isArray(s) ? (s[0] ?? '') : '')).join('');
  if (translated.length === 0) throw new Error('google-free returned empty translation');
  const src = typeof outer[2] === 'string' ? normaliseSource(outer[2]) : null;
  return { translatedText: translated, detectedSourceLanguage: src, confidence: null, model: MODEL_GOOGLE };
}

function parseMyMemory(raw: string, target: string): ProviderResult {
  const data = JSON.parse(raw) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
    matches?: { id?: string; segment?: string; translation?: string }[];
  };
  const translated = (data.responseData?.translatedText || '').trim();
  if (!translated || (data.responseStatus != null && data.responseStatus !== 200)) {
    throw new Error(`mymemory status ${data.responseStatus ?? 'unknown'}`);
  }
  // MyMemory does not always return a reliable detected source; leave null so
  // the Edge same-language gate falls through to text-equality checks.
  void target;
  return { translatedText: translated, detectedSourceLanguage: null, confidence: null, model: MODEL_MYMEMORY };
}

const RETRYABLE = new Set([429, 500, 502, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchGoogle(input: ProviderInput): Promise<ProviderResult> {
  const url = buildGoogleUrl(input);
  const body = new URLSearchParams({ q: input.text }).toString();
  let lastDetail = 'exhausted retries';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.ok) return parseGoogle(await res.text());
    const detail = (await res.text()).slice(0, 300);
    lastDetail = `google-free http ${res.status}: ${detail}`;
    if (RETRYABLE.has(res.status) && attempt < 3) {
      await sleep(700 * Math.pow(2, attempt)); // 0.7s, 1.4s, 2.8s
      continue;
    }
    throw new Error(lastDetail);
  }
  throw new Error(lastDetail);
}

async function fetchMyMemory(input: ProviderInput): Promise<ProviderResult> {
  const tl = targetCode(input.targetLanguage);
  // Prefer an explicit source hint when present; otherwise `Autodetect`.
  const sl = input.sourceHint ? targetCode(input.sourceHint) : 'Autodetect';
  const params = new URLSearchParams({
    q: input.text.slice(0, 500),
    langpair: `${sl}|${tl}`,
  });
  const res = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`mymemory http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parseMyMemory(await res.text(), input.targetLanguage);
}

export class GoogleFreeProvider implements TranslationProvider {
  async translate(input: ProviderInput): Promise<ProviderResult> {
    try {
      return await fetchGoogle(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[googlefree] primary failed, trying mymemory', { detail: msg.slice(0, 200) });
      return await fetchMyMemory(input);
    }
  }
}
