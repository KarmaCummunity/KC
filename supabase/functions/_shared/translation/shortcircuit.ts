// supabase/functions/_shared/translation/shortcircuit.ts
// Server-side guards: skip work that should never be translated, and skip
// when source and target are the same base language. Mirrors @kc/domain
// (re-implemented because Deno cannot import the workspace package here).
// Used by the KC `translate` Edge Function.

const EMOJI_OR_SPACE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;
const URL_ONLY = /^\s*https?:\/\/\S+\s*$/u;
const NUMBER_ONLY = /^[\s\d.,:%+\-]+$/u;

/** False when content is empty / emoji-only / url-only / number-only. */
export function isTranslatable(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (EMOJI_OR_SPACE.test(t)) return false;
  if (URL_ONLY.test(t)) return false;
  if (NUMBER_ONLY.test(t)) return false;
  return true;
}

/** Base language subtag, lowercased (e.g. "en-US" -> "en"). */
function baseLang(tag: string): string {
  return tag.split('-')[0]!.toLowerCase();
}

/** True when source is unknown or its base language differs from the target. */
export function needsTranslation(source: string | null, target: string): boolean {
  if (!source) return true;
  return baseLang(source) !== baseLang(target);
}

// Script heuristics — blocks
// he→he / en→en provider calls when detection is null or wrong.
const HEBREW = /[\u0590-\u05FF]/;
const NON_LATIN = /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF]/;

/** True when `text` already matches the target language's script. */
export function sameLanguageSkip(text: string, readerLang: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (readerLang === 'he') return HEBREW.test(t);
  if (readerLang === 'en') return !NON_LATIN.test(t);
  return false;
}
