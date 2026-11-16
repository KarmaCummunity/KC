// supabase/functions/_shared/post-extraction/gemini.ts
// Gemini Flash adapter of the extraction seam. NOTE: the free tier is not zero-retention; the
// DPA model must be in place before public launch (D-63 parity, FR-IMPORT-009 AC2). Only the
// scrubbed text is ever sent (FR-IMPORT-002 AC3).

import { buildUserPayload, EXTRACTION_SYSTEM } from './prompt.ts';
import {
  ExtractionProviderError,
  type ExtractionProviderInput,
  type ExtractionProviderResult,
  type PostExtractionProvider,
} from './providerTypes.ts';
import { EXTRACTION_RESPONSE_SCHEMA } from './schema.ts';

const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
/** Transient statuses worth one quick retry (rate limit and upstream blips). */
const RETRYABLE = new Set([429, 500, 503]);
/** FR-IMPORT-006 AC4: a call slower than this falls back to the manual route. */
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 400;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Replaceable so tests need not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** The request body: deterministic (temperature 0), JSON-only, constrained by the response schema. */
export function buildRequestBody(input: ExtractionProviderInput) {
  return {
    systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPayload(input) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    },
  };
}

/** The model's JSON out of Gemini's envelope. */
export function parseEnvelope(body: string): unknown {
  try {
    const outer = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = outer.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new Error('no text part');
    return JSON.parse(text);
  } catch {
    throw new ExtractionProviderError('bad_response', 'gemini answered with something that is not the expected JSON');
  }
}

export class GeminiExtractionProvider implements PostExtractionProvider {
  constructor(private readonly options: GeminiOptions) {}

  async extract(input: ExtractionProviderInput): Promise<ExtractionProviderResult> {
    const { apiKey, model } = this.options;
    if (!apiKey) throw new ExtractionProviderError('not_configured', 'GEMINI_API_KEY is not set');
    const doFetch = this.options.fetchFn ?? fetch;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const body = JSON.stringify(buildRequestBody(input));

    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await doFetch(ENDPOINT(model), {
          method: 'POST',
          // The key travels in a header, never in the URL, so it cannot reach a log line.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
        throw new ExtractionProviderError(timedOut ? 'timeout' : 'http', timedOut ? 'gemini timed out' : 'gemini unreachable');
      }
      if (res.ok) return { raw: parseEnvelope(await res.text()), model };
      if (RETRYABLE.has(res.status) && attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new ExtractionProviderError('http', `gemini http ${res.status}`);
    }
    throw new ExtractionProviderError('http', 'gemini exhausted retries');
  }
}
