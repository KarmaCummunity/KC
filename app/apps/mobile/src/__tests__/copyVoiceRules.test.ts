import { describe, it, expect } from 'vitest';
import {
  BUTTON_MAX_WORDS,
  HIDDEN_MEANING_ALLOWED_FILES,
  checkCopy,
  countCopyFindings,
  singularImperatives,
  wordCount,
} from './guardKit/copyVoiceRules';
import { extractLocaleStrings, type LocaleString } from './guardKit/localeStrings';

// Unit tests for the copy-voice rules — spec 17 §7 (D93), FR-RESP-006 AC19/AC20.

function he(text: string, key: string | null = 'body'): LocaleString {
  return { key, text, line: 1, endLine: 1 };
}

describe('extractLocaleStrings', () => {
  it('reads values with their key, lines and closing column, and skips comments', () => {
    const source = [
      '// header comment with a \'quote\'',
      'export const x = {',
      "  publishCta: 'פרסום', /* note */",
      '  longBody:',
      "    'שורה ארוכה',",
      '  nested: { title: "כותרת" },',
      '};',
    ].join('\n');
    expect(extractLocaleStrings(source)).toEqual([
      { key: 'publishCta', text: 'פרסום', line: 3, endLine: 3, endColumn: 21 },
      { key: 'longBody', text: 'שורה ארוכה', line: 5, endLine: 5, endColumn: 16 },
      { key: 'title', text: 'כותרת', line: 6, endLine: 6, endColumn: 26 },
    ]);
  });

  it('turns template expressions into placeholders and ignores arrow parameters as keys', () => {
    const source = "const x = { ageDays: (d: number) => `לפני ${d} ימים`, 'quoted-key': 'ערך', esc: 'a\\'b' };";
    expect(extractLocaleStrings(source).map(({ key, text }) => ({ key, text }))).toEqual([
      { key: 'ageDays', text: 'לפני {{x}} ימים' },
      { key: 'quoted-key', text: 'ערך' },
      { key: 'esc', text: "a'b" },
    ]);
  });

  it('decodes \\uXXXX and \\u{…} escapes like JavaScript', () => {
    const source = "const x = { send: '\\u05e9\\u05dc\\u05d7', mark: '\\u{5d0}!' };";
    expect(extractLocaleStrings(source).map(({ text }) => text)).toEqual(['שלח', 'א!']);
  });

  it('records the end line of a multi-line template literal', () => {
    const [entry] = extractLocaleStrings('const x = {\n  body: `שורה\nשנייה`,\n};');
    expect(entry).toMatchObject({ key: 'body', line: 2, endLine: 3 });
  });
});

describe('jargon rule', () => {
  it('flags English product jargon in Hebrew copy', () => {
    expect(checkCopy(he('זה ה-MVP שלנו, בלי KPI ובלי toggle'), 'he')).toEqual({ jargon: 3 });
  });

  it('flags internal acronyms in English copy but not plain words', () => {
    expect(checkCopy(he('Our MVP and North Star'), 'en')).toEqual({ jargon: 2 });
    expect(checkCopy(he('Scale the vision with a toggle'), 'en')).toEqual({});
  });
});

describe('genderedImperative rule', () => {
  it('flags masculine and feminine singular imperatives that open a sentence', () => {
    expect(singularImperatives('שלח הודעה')).toEqual(['שלח']);
    expect(singularImperatives('אירעה שגיאה. נסה שוב.')).toEqual(['נסה']);
    expect(singularImperatives('🗑 מחק משימה')).toEqual(['מחק']);
    expect(singularImperatives('שמרי פוסט כדי לראות אותו')).toEqual(['שמרי']);
  });

  it('accepts the neutral forms: infinitive, plural imperative and action nouns', () => {
    expect(singularImperatives('ללחוץ כאן. אפשר לבחור עיר. נסו שוב. שליחת קישור')).toEqual([]);
  });

  it('ignores mid-sentence words, nouns, adjectives and past or passive reports', () => {
    expect(singularImperatives('הפוסט סגור')).toEqual([]);
    expect(singularImperatives('המשך')).toEqual([]);
    expect(singularImperatives('הצטרף ב-{{x}}')).toEqual([]);
    expect(singularImperatives('הסיבה: דווח על-ידי מספר משתמשים')).toEqual([]);
    expect(singularImperatives('{{name}} שלח לך הודעה')).toEqual([]);
  });
});

describe('genderedAddress rule', () => {
  it('flags singular second-person address anywhere', () => {
    expect(checkCopy(he('מה אתה נותן? כשאתה מוכן, תוכלי לפרסם'), 'he')).toEqual({ genderedAddress: 3 });
  });

  it('does not flag the object marker or gender-ambiguous possessives', () => {
    expect(checkCopy(he('בחירת את העיר שלך. יש לך טיוטה'), 'he')).toEqual({});
  });
});

describe('paddedSoftener rule', () => {
  it('flags AC19 padded softeners', () => {
    expect(checkCopy(he('אנא בחירת עיר. נשמח אם תעדכנו'), 'he')).toEqual({ paddedSoftener: 2 });
  });

  it('keeps an informative "ייתכן ש" and words that only contain the letters', () => {
    expect(checkCopy(he('ייתכן שהפוסט נסגר. אנאלוגיה'), 'he')).toEqual({});
  });
});

describe('ktivHaser rule', () => {
  it('flags ktiv haser spellings, also after a prefix', () => {
    expect(checkCopy(he('תכנה, השרות והבטול'), 'he')).toEqual({ ktivHaser: 3 });
  });

  it('accepts ktiv maleh and look-alike words', () => {
    expect(checkCopy(he('תוכנה, שירות, ביטול, משרות פנויות'), 'he')).toEqual({});
  });
});

describe('buttonLength rule', () => {
  it(`flags a call-to-action longer than ${BUTTON_MAX_WORDS} words`, () => {
    expect(checkCopy(he('אין לי חשבון עדיין — הרשמה', 'switchCta'), 'he')).toEqual({ buttonLength: 1 });
  });

  it('counts only words, and only on CTA keys', () => {
    expect(wordCount('🗑 + שמירת {{count}} פריטים ✓')).toBe(3);
    expect(checkCopy(he('📤 פתיחה מחדש של הפוסט', 'reopenCta'), 'he')).toEqual({});
    expect(checkCopy(he('טקסט ארוך של חמש מילים', 'shareCtaGiveOpen'), 'he')).toEqual({});
  });
});

describe('brandWording rule', () => {
  it('flags a variant of the key slogan and a transliterated brand name', () => {
    expect(checkCopy(he('״לתת זה גם לקבל״'), 'he')).toEqual({ brandWording: 1 });
    expect(checkCopy(he('קארמה קומיוניטי'), 'he')).toEqual({ brandWording: 1 });
    expect(checkCopy(he('Join karma community'), 'en')).toEqual({ brandWording: 1 });
  });

  it('accepts the exact slogan and brand name', () => {
    expect(checkCopy(he('לתת — זה גם לקבל.'), 'he')).toEqual({});
    expect(checkCopy(he('Join Karma Community'), 'en')).toEqual({});
  });
});

describe('hiddenMeaning rule (D67)', () => {
  it('flags the internal "capitalist kibbutz" meaning in either language', () => {
    expect(checkCopy(he('הקיבוץ הקפיטליסטי — רשת של נתינה'), 'he')).toEqual({ hiddenMeaning: 1 });
    expect(checkCopy(he('KC is also a capitalist kibbutz'), 'en')).toEqual({ hiddenMeaning: 1 });
  });

  it('accepts the public slogan "קיבוץ דיגיטלי"', () => {
    expect(checkCopy(he('קיבוץ דיגיטלי בעולם טכנולוגי.'), 'he')).toEqual({});
    expect(checkCopy(he('A digital kibbutz in a tech world'), 'en')).toEqual({});
  });
});

describe('hiddenMeaning exemption for the About screen and FAQ (D93 refines D67)', () => {
  const hebrew = "export const x = { tagline: 'הקיבוץ הקפיטליסטי — רשת של נתינה' };";
  const english = "export const x = { a: 'KC is also a capitalist kibbutz' };";

  it('does not count it in the About and FAQ modules, in either locale', () => {
    expect(countCopyFindings(hebrew, 'he', 'src/i18n/locales/he/modules/aboutContentCopyA.ts')).toEqual({});
    expect(countCopyFindings(english, 'en', 'src/i18n/locales/en/modules/aboutContentNavFaq.ts')).toEqual({});
  });

  it('still counts it in every other locale module', () => {
    expect(countCopyFindings(hebrew, 'he', 'src/i18n/locales/he/modules/auth.ts')).toEqual({ hiddenMeaning: 1 });
    expect(countCopyFindings(english, 'en', 'src/i18n/locales/en/modules/onboarding.ts')).toEqual({ hiddenMeaning: 1 });
    expect(countCopyFindings(hebrew, 'he')).toEqual({ hiddenMeaning: 1 });
  });

  it('lists only About / FAQ modules, and exempts no other rule there', () => {
    expect([...HIDDEN_MEANING_ALLOWED_FILES].every((file) => /\/modules\/aboutContent\w+\.ts$/.test(file))).toBe(true);
    const imperative = "export const x = { a: 'שלח הודעה' };";
    const about = 'src/i18n/locales/he/modules/aboutContentCopyA.ts';
    expect(countCopyFindings(imperative, 'he', about)).toEqual({ genderedImperative: 1 });
  });
});

describe('countCopyFindings', () => {
  it('sums findings per module and skips strings allowed with a reason', () => {
    const source = [
      'export const x = {',
      "  a: 'שלח הודעה',",
      "  b: 'מחק', // copy-voice-allow: confirm keyword the user types",
      "  c: 'שמור', // copy-voice-allow:",
      '};',
    ].join('\n');
    expect(countCopyFindings(source, 'he')).toEqual({ genderedImperative: 2 });
  });

  it('ignores marker text inside a string: only a comment after the closing quote exempts it', () => {
    const source = "export const x = {\n  a: 'שלח // copy-voice-allow: not a comment',\n};";
    expect(countCopyFindings(source, 'he')).toEqual({ genderedImperative: 1 });
  });

  it('never lets an allow marker exempt the hidden meaning outside About / FAQ', () => {
    const source = "export const x = {\n  a: 'קיבוץ קפיטליסטי', // copy-voice-allow: easter egg\n};";
    expect(countCopyFindings(source, 'he', 'src/i18n/locales/he/modules/feed.ts')).toEqual({ hiddenMeaning: 1 });
  });
});
