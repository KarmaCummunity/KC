// FR-TRANSLATE-003 — target languages the reader UX offers. Server-side gate so
// an arbitrary tag cannot spend a provider call / poison the cache. Keep in sync
// with the mobile picker constant (SUPPORTED_TRANSLATION_LANGUAGES).
// `am` (Amharic) is accepted here but not offered by the mobile picker, which
// has its own list, so this wider set does not alter the mobile UX.
export const SUPPORTED_TARGET_LANGUAGES = new Set(['he', 'en', 'ar', 'ru', 'am']);

/** Base-language match (e.g. 'en-US' → 'en'). */
export function isSupportedTarget(tag: string): boolean {
  const base = tag.toLowerCase().split('-')[0];
  return SUPPORTED_TARGET_LANGUAGES.has(base);
}
