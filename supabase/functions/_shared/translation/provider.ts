// supabase/functions/_shared/translation/provider.ts
// Pluggable translation-provider seam shared by the KC `translate` Edge Function.
// Swapping providers (e.g. free Gemini ->
// paid zero-retention/DPA Flash, D-63/D-65) is a TRANSLATION_PROVIDER env change.

export interface ProviderInput {
  text: string;
  /** BCP-47 target, may be variant-specific (e.g. zh-Hant). */
  targetLanguage: string;
  /** Optional hint; the provider still self-detects (§8). */
  sourceHint?: string | null;
}

export interface ProviderResult {
  translatedText: string;
  detectedSourceLanguage: string | null;
  /** 0..1 self-rated confidence; null when the provider gives none. */
  confidence: number | null;
  /** Model/provider id stored as provenance in *_content_translations.model. */
  model: string;
}

export interface TranslationProvider {
  translate(input: ProviderInput): Promise<ProviderResult>;
}

import { readEnv } from '../readEnv.ts';
import { GeminiFlashProvider } from './gemini.ts';
import { GoogleFreeProvider } from './googlefree.ts';

// Default to the keyless free provider: the free Gemini tier is not universally
// available (some projects/regions return `limit: 0`, TD-75) and the PM
// directive is "free models only, no billing". Gemini stays opt-in via
// TRANSLATION_PROVIDER=gemini for when a DPA/paid key lands (D-63/D-65).
export function selectProvider(): TranslationProvider {
  const kind = readEnv('TRANSLATION_PROVIDER', 'googlefree').toLowerCase();
  switch (kind) {
    case 'googlefree':
    case 'google':
      return new GoogleFreeProvider();
    case 'gemini':
      return new GeminiFlashProvider();
    default:
      throw new Error(`unknown TRANSLATION_PROVIDER '${kind}'`);
  }
}
