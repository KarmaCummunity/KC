// Hebrew search helpers — same niqqud / cantillation range as
// `normalizeKnowledgeText` and `normalizeMessage` (U+0591–U+05C7).

const HEBREW_NIQQUD = /[\u0591-\u05C7]/g;

/** Strip Hebrew niqqud and cantillation marks; leave every other character intact. */
export function stripHebrewNiqqud(text: string): string {
  return text.replace(HEBREW_NIQQUD, '');
}

/**
 * Case-fold + strip niqqud for chat / name search matching (FR-CHAT-001 AC3).
 * Non-Hebrew letters and punctuation are unchanged aside from lower-casing.
 */
export function normalizeChatSearchText(text: string): string {
  return stripHebrewNiqqud(text).toLowerCase();
}
