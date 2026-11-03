// Copy-voice rules — spec 17 §7 "Voice and tone" (D93), FR-RESP-006 AC19/AC20.
// Pure functions over one locale string; the guard test counts their findings per file.
// Word lists favour precision over recall: a word is listed only when, in that
// position, it cannot reasonably be read as a noun or an adjective.

import { extractLocaleStrings, type LocaleString } from './localeStrings';

export type CopyLocale = 'he' | 'en';

export const COPY_RULES = [
  'jargon',
  'genderedImperative',
  'genderedAddress',
  'paddedSoftener',
  'ktivHaser',
  'buttonLength',
  'brandWording',
  'hiddenMeaning',
] as const;

export type CopyRule = (typeof COPY_RULES)[number];
export type CopyCounts = Partial<Record<CopyRule, number>>;

/** Allow marker: an end-of-line comment on the line the literal ends, with a reason. */
export const COPY_ALLOW_MARKER = 'copy-voice-allow:';
const ALLOW_COMMENT = new RegExp(`//.*${COPY_ALLOW_MARKER}\\s*\\S`);

/** Max words on a call-to-action (AC19). */
export const BUTTON_MAX_WORDS = 4;
const BUTTON_KEY = /^cta$|(?:Cta|Btn|Button)$/;

// Master narrative §15: English product jargon never appears in Hebrew copy.
const HE_JARGON =
  /\b(?:MVP|PMF|KPIs?|North Star|toggle|vision|philanthropy|infrastructure|scale)\b/gi;
// English copy (D-167) keeps the same voice: no internal product acronyms.
const EN_JARGON = /\b(?:MVP|PMF|KPIs?|North Star)\b/g;

// Masculine (and feminine) singular imperatives, flagged only as the first word of
// a sentence, where a UI string means them as a command. Left out on purpose:
// המשך (noun "continuation"), סגור/חסום/מלא/כתוב (adjectives), אשר (relative
// "which"), ספר/צלם/השאר/הזמן/אמת/אפס/עבור (nouns or prepositions), היה/לך (other
// words), דחה (reads as "rejected" in notification bodies).
const SINGULAR_IMPERATIVES = new Set([
  // masculine
  'לחץ', 'הקש', 'בחר', 'הוסף', 'הסר', 'שלח', 'פרסם', 'שמור', 'מחק', 'ערוך', 'עדכן',
  'סמן', 'פתח', 'התחל', 'נסה', 'חזור', 'בטל', 'דווח', 'עקוב', 'הפסק', 'הצטרף', 'הירשם',
  'היכנס', 'התחבר', 'התנתק', 'צור', 'הזן', 'הקלד', 'בקר', 'הצץ', 'שתף', 'העתק', 'הפוך',
  'החלף', 'הגדר', 'הצג', 'הסתר', 'חפש', 'סנן', 'רענן', 'העלה', 'גלול', 'גרור', 'בדוק',
  'ודא', 'וודא', 'הפעל', 'כבה', 'נקה', 'שחזר', 'דרג', 'הגב', 'השב', 'בקש', 'הגש', 'צרף',
  'סיים', 'בוא', 'תן', 'קח',
  // feminine
  'לחצי', 'בחרי', 'הוסיפי', 'הסירי', 'שלחי', 'פרסמי', 'שמרי', 'מחקי', 'ערכי', 'עדכני',
  'סמני', 'פתחי', 'התחילי', 'נסי', 'חזרי', 'בטלי', 'עקבי', 'הצטרפי', 'הירשמי', 'היכנסי',
  'התחברי', 'הזיני', 'שתפי', 'חפשי', 'בדקי', 'בואי', 'תני',
]);

// Singular second-person address anywhere in the string (optionally after ו/ש/כש).
// Not listed: את (also the object marker), לך/שלך/אותך (same spelling for both genders).
const SINGULAR_ADDRESS = /^(?:ו|ש|כש|וכש|וש)?(?:אתה|הינך|הנך|תוכלי|תרצי)$/;

// AC19 padded softeners. A plain "ייתכן ש" (the post may have been closed) is information, not padding.
const PADDED_SOFTENER = /(?:^|[^א-ת])(?:נשמח אם|אנא|ייתכן שכדאי)(?![א-ת])/g;

// Ktiv haser spellings with an unambiguous ktiv maleh form (master narrative §15).
const KTIV_HASER = new Set([
  'תכנה', 'תכנית', 'תכניות', 'שרות', 'שרותים', 'שרותי', 'תאור', 'אשור', 'בטול', 'חפוש',
  'שתוף', 'צלום', 'תקון', 'סנון', 'פרוט', 'נהול', 'זהוי', 'בקורת', 'דרוג', 'חבור',
]);
// Only these prefixes: מ/ש/כ would turn real words into matches (משרות = jobs).
const HASER_PREFIXES = ['', 'ו', 'ה', 'ב', 'ל', 'וה', 'וב', 'ול'] as const;

// Brand wording: the key line is locked (§16.1); the name is never transliterated (spec 17 §1).
export const KEY_SLOGAN = 'לתת — זה גם לקבל';
const SLOGAN_VARIANT = /לתת\s*[-–—]?\s*זה גם לקבל/g;
const HE_BRAND_TRANSLITERATION = /קומיוניטי/g;
const EN_BRAND_VARIANT = /\bkarma community\b/gi;
// "קיבוץ קפיטליסטי" is a subtle easter egg: never in UI copy except the About screen and
// its FAQ (spec 17 §1, D67 refined by D93, PM 2026-10-30).
const HE_HIDDEN_MEANING = /קיבוץ\s+(?:ה)?קפיטליסטי/g;
const EN_HIDDEN_MEANING = /\bcapitalist kibbutz/gi;

const SENTENCE_BREAK = /[.!?:\n—–]|\s-\s/;
const NARRATION_NEXT = /^(?:ב-|על[- ]ידי|ע"י)/;
const HEBREW_WORD = /[א-ת]+/g;
const WORDY_TOKEN = /[א-תA-Za-z0-9{]/;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** First word of a sentence, letters only; empty when it is not a plain Hebrew word. */
function firstWord(sentence: string): { word: string; rest: string } {
  const tokens = sentence.trim().split(/\s+/);
  const index = tokens.findIndex((token) => WORDY_TOKEN.test(token));
  if (index === -1 || /[A-Za-z0-9{]/.test(tokens[index])) return { word: '', rest: '' };
  const word = tokens[index].replace(/^[^א-ת]+|[^א-ת]+$/g, '');
  return { word, rest: tokens.slice(index + 1).join(' ') };
}

/**
 * Sentences that open with a singular imperative. A verb followed by "ב-<when>"
 * or "על-ידי" is a past or passive report ("הצטרף ב-…", "דווח על-ידי…"), not a command.
 */
export function singularImperatives(text: string): string[] {
  return text.split(SENTENCE_BREAK).flatMap((sentence) => {
    const { word, rest } = firstWord(sentence);
    return SINGULAR_IMPERATIVES.has(word) && !NARRATION_NEXT.test(rest) ? [word] : [];
  });
}

/** Words of a call-to-action: tokens with a letter, digit or placeholder (emoji and arrows do not count). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => WORDY_TOKEN.test(token)).length;
}

function isHaser(word: string): boolean {
  return HASER_PREFIXES.some((prefix) => word.startsWith(prefix) && KTIV_HASER.has(word.slice(prefix.length)));
}

function hebrewCounts(entry: LocaleString): CopyCounts {
  const { text, key } = entry;
  const words = text.match(HEBREW_WORD) ?? [];
  const slogans = text.match(SLOGAN_VARIANT) ?? [];
  return {
    jargon: count(text, HE_JARGON),
    genderedImperative: singularImperatives(text).length,
    genderedAddress: words.filter((word) => SINGULAR_ADDRESS.test(word)).length,
    paddedSoftener: count(text, PADDED_SOFTENER),
    ktivHaser: words.filter(isHaser).length,
    buttonLength: key && BUTTON_KEY.test(key) && wordCount(text) > BUTTON_MAX_WORDS ? 1 : 0,
    brandWording:
      slogans.filter((slogan) => slogan !== KEY_SLOGAN).length + count(text, HE_BRAND_TRANSLITERATION),
    hiddenMeaning: count(text, HE_HIDDEN_MEANING),
  };
}

function englishCounts(entry: LocaleString): CopyCounts {
  const variants = entry.text.match(EN_BRAND_VARIANT) ?? [];
  return {
    jargon: count(entry.text, EN_JARGON),
    brandWording: variants.filter((name) => name !== 'Karma Community').length,
    hiddenMeaning: count(entry.text, EN_HIDDEN_MEANING),
  };
}

/** Findings for one string, zero counts dropped. */
export function checkCopy(entry: LocaleString, locale: CopyLocale): CopyCounts {
  const all = locale === 'he' ? hebrewCounts(entry) : englishCounts(entry);
  return Object.fromEntries(Object.entries(all).filter(([, found]) => found > 0)) as CopyCounts;
}

/**
 * Whether the literal is followed, on the line it ends, by `// copy-voice-allow: <reason>`.
 * Only the text after the closing quote counts, so marker text inside a string exempts nothing.
 */
export function isAllowed(entry: LocaleString, lines: readonly string[]): boolean {
  return ALLOW_COMMENT.test((lines[entry.endLine - 1] ?? '').slice(entry.endColumn ?? 0));
}

// The only locale modules where `hiddenMeaning` is exempt: the About screen bundle
// (`aboutContent` = aboutContentBundle and the modules it merges) and its FAQ
// (aboutContentNavFaq), in both locales. Explicit paths on purpose: a new module
// is not exempt until it is listed here and reviewed (D93 refines D67).
const ABOUT_AND_FAQ_MODULES = [
  'aboutContentBundle',
  'aboutContentCopyA',
  'aboutContentCopyB',
  'aboutContentCopyC',
  'aboutContentNavFaq',
  'aboutContentUxRefreshPartA',
  'aboutContentUxRefreshPartB',
] as const;
export const HIDDEN_MEANING_ALLOWED_FILES: ReadonlySet<string> = new Set(
  (['he', 'en'] as const).flatMap((locale) =>
    ABOUT_AND_FAQ_MODULES.map((module) => `src/i18n/locales/${locale}/modules/${module}.ts`),
  ),
);

/**
 * Findings for a whole locale module (`file` is mobile-relative). An allow marker exempts
 * every rule except `hiddenMeaning`, which only the About / FAQ modules may carry (D93).
 */
export function countCopyFindings(source: string, locale: CopyLocale, file = ''): CopyCounts {
  const lines = source.split('\n');
  const totals: CopyCounts = {};
  for (const entry of extractLocaleStrings(source)) {
    const allowed = isAllowed(entry, lines);
    for (const [rule, found] of Object.entries(checkCopy(entry, locale)) as [CopyRule, number][]) {
      if (allowed && rule !== 'hiddenMeaning') continue;
      totals[rule] = (totals[rule] ?? 0) + found;
    }
  }
  if (HIDDEN_MEANING_ALLOWED_FILES.has(file)) delete totals.hiddenMeaning;
  return totals;
}
