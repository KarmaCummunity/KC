// Explicit offer and request words in a shared message. The model's direction
// is only trusted as far as the text backs it (FR-IMPORT-006 AC1): no cue
// lowers it, both cues make it a conflict. The word lists are heuristics
// measured by the golden set (FR-IMPORT-010), not a parser; they are matching
// data, not interface copy, which is why they live in source.
//
// Ported from `supabase/functions/_shared/post-extraction/cues.ts`.

// "gives", "for handing over", "offers", "hands out", "travelling" and English equivalents.
const OFFER_WORDS = [
  'מוסר', 'מוסרת', 'מוסרים', 'למסירה', 'נותן', 'נותנת', 'מציע', 'מציעה', 'מחלק', 'מחלקת',
  'נוסע', 'נוסעת', 'giving away', 'offering', 'free to take',
];
// "looking for", "needs", "in need of", "wanted", "asks" and English equivalents.
const REQUEST_WORDS = [
  'מחפש', 'מחפשת', 'מחפשים', 'צריך', 'צריכה', 'צריכים', 'זקוק', 'זקוקה', 'דרוש', 'דרושה', 'מבקש', 'מבקשת',
  'looking for', 'need', 'wanted',
];

/** Whole-word match; a leading Hebrew "and" is allowed. */
function anyWord(text: string, words: readonly string[]): boolean {
  return new RegExp(`(?<![\\p{L}])ו?(?:${words.join('|')})(?![\\p{L}])`, 'iu').test(text);
}

export interface DirectionCues {
  readonly offer: boolean;
  readonly request: boolean;
}

/** Which kinds of cue words the text holds. */
export function directionCues(text: string): DirectionCues {
  return { offer: anyWord(text, OFFER_WORDS), request: anyWord(text, REQUEST_WORDS) };
}
