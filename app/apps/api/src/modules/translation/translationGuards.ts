// What is never sent to a provider (FR-TRANSLATE-002/003): text that is not
// language, text already in the reader's language, and target languages the
// app does not offer.
//
// Ported from `supabase/functions/_shared/translation/{shortcircuit,supportedLanguages}.ts`
// as they are. `isTranslatable` here is the server's rule and is stricter than
// `@kc/domain`'s for texts like "12:30" or "50%"; the two are kept apart until
// the product decides on one, so the move changes no behavior.

import { needsTranslation } from '@kc/domain';

/** Longest source text the server translates, in characters. */
export const MAX_SOURCE_LENGTH = 5000;

/**
 * Target languages the reader may ask for. A server-side gate, so an arbitrary
 * tag cannot spend a provider call or fill the cache. `am` (Amharic) is
 * accepted but not offered by the mobile picker, which has its own list.
 */
export const SUPPORTED_TARGET_LANGUAGES: ReadonlySet<string> = new Set(['he', 'en', 'ar', 'ru', 'am']);

/** Base-language match (`en-US` → `en`). */
export function isSupportedTarget(tag: string): boolean {
  return SUPPORTED_TARGET_LANGUAGES.has(tag.toLowerCase().split('-')[0] as string);
}

const EMOJI_OR_SPACE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;
const URL_ONLY = /^\s*https?:\/\/\S+\s*$/u;
const NUMBER_ONLY = /^[\s\d.,:%+-]+$/u;

/** False when the text is empty, emoji only, one address only or numbers only. */
export function isTranslatable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !EMOJI_OR_SPACE.test(trimmed) && !URL_ONLY.test(trimmed) && !NUMBER_ONLY.test(trimmed);
}

const HEBREW = /[\u0590-\u05FF]/;
/** Hebrew, Arabic, Cyrillic, Greek and CJK ideographs. */
const NON_LATIN = /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF]/;

/**
 * True when `text` is already written in the reader's script, judged without
 * a provider: it stops Hebrew→Hebrew and English→English calls when language
 * detection is missing or wrong. Other target languages are never skipped here.
 */
export function sameLanguageSkip(text: string, readerLanguage: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (readerLanguage === 'he') return HEBREW.test(trimmed);
  if (readerLanguage === 'en') return !NON_LATIN.test(trimmed);
  return false;
}

/**
 * True when a cached translation may be served for `sourceText`: it is not
 * empty, not the source text itself, and not a "translation" into the
 * language the text was already in (rows an older provider wrote by mistake).
 */
export function isUsableCachedTranslation(
  sourceText: string,
  targetLanguage: string,
  cached: { readonly translatedText: string; readonly sourceLanguage: string | null },
): boolean {
  const translated = (cached.translatedText || '').trim();
  if (!translated || translated === sourceText.trim()) return false;
  return !cached.sourceLanguage || needsTranslation(cached.sourceLanguage, targetLanguage);
}
