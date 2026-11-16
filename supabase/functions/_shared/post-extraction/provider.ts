// supabase/functions/_shared/post-extraction/provider.ts
// Picks the extraction provider (FR-IMPORT-009 AC2, ADR-008), shaped like the translation seam:
// swapping the free tier for a zero-retention DPA model (D-63 parity) is an env change, never a
// code change.

import { readEnv } from '../readEnv.ts';
import { GeminiExtractionProvider } from './gemini.ts';
import type { PostExtractionProvider } from './providerTypes.ts';

/** Provider chosen by EXTRACTION_PROVIDER (default `gemini`); a missing key fails per call, not at load. */
export function providerFromEnv(): PostExtractionProvider {
  const kind = readEnv('EXTRACTION_PROVIDER', 'gemini').toLowerCase();
  if (kind !== 'gemini') throw new Error(`unknown EXTRACTION_PROVIDER '${kind}'`);
  return new GeminiExtractionProvider({
    apiKey: readEnv('GEMINI_API_KEY'),
    model: readEnv('EXTRACTION_MODEL', 'gemini-2.0-flash'),
  });
}
