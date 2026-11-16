// supabase/functions/_shared/post-extraction/cues.ts
// Explicit offer / request words in the text. The model's direction is only trusted as far as
// the text backs it (FR-IMPORT-006 AC1): no cue lowers it, both cues make it a conflict.
// The word lists are heuristics measured by the golden set (FR-IMPORT-010), not a parser.

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
  const re = new RegExp(`(?<![\\p{L}])ו?(?:${words.join('|')})(?![\\p{L}])`, 'iu');
  return re.test(text);
}

export interface DirectionCues {
  offer: boolean;
  request: boolean;
}

export function directionCues(text: string): DirectionCues {
  return { offer: anyWord(text, OFFER_WORDS), request: anyWord(text, REQUEST_WORDS) };
}
