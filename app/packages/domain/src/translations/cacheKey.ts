/** Collapse internal whitespace runs to single spaces and trim. Case is preserved. */
export function normalizeForCache(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;
const NUMBER_ONLY = /^[\d.,\s]+$/;
// Strip emoji + symbol + punctuation + whitespace; if nothing remains, it's not
// translatable natural-language text.
const NON_TEXT = /[\p{Extended_Pictographic}\p{Emoji_Component}\s\d.,!?()-]/gu;

/** True only when the value contains translatable natural-language text. */
export function isTranslatable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (URL_ONLY.test(t)) return false;
  if (NUMBER_ONLY.test(t)) return false;
  const residue = t.replace(NON_TEXT, '');
  return residue.length > 0;
}

/** Whether a translation is required: unknown source, or source base != target base. */
export function needsTranslation(source: string | null, target: string): boolean {
  if (!source) return true;
  const base = (s: string) => s.toLowerCase().split('-')[0];
  return base(source) !== base(target);
}
