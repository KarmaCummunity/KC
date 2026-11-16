export interface ScrubResult {
  readonly text: string;
  readonly removed: { readonly phone: number; readonly email: number; readonly id: number; readonly url: number };
}

// Placeholders are typed so the draft can tell the member what was removed (FR-IMPORT-002 AC3).
export const IMPORT_PLACEHOLDER_PATTERN = /<(?:PHONE|EMAIL|ID|URL)>/g;

// Order matters: URLs first (digits inside a wa.me link must not become a phone), then e-mail,
// long digit runs (cards / bank), phones, and the 9-digit national id last.
const URL_RE =
  /(?:https?:\/\/|www\.)\S+|(?:wa\.me|chat\.whatsapp\.com|facebook\.com|fb\.com|fb\.me|bit\.ly|yad2\.co\.il)\/\S*/gi;
const EMAIL_RE = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.\p{L}{2,}/gu;
const LONG_DIGITS_RE = /(?<![\d+])\d(?:[ -]?\d){12,18}(?!\d)/g;
// Israeli mobile (05X) and landline (02/03/04/08/09), with 0, 972 or +972 and optional separators.
const PHONE_RE = /(?<![\d])(?:\+?972[\s-]?|0)(?:5\d|[23489])[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;
const NATIONAL_ID_RE = /(?<!\d)\d{9}(?!\d)/g;

function replaceCounting(text: string, re: RegExp, placeholder: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(re, () => {
    count += 1;
    return placeholder;
  });
  return { text: out, count };
}

/**
 * Replace contact details with typed placeholders BEFORE any text reaches a model provider
 * (FR-IMPORT-002 AC3). Personal names are deliberately not scrubbed: by rule they cannot be told
 * apart from place and item words, so the member reviews the text in the draft (AC4).
 * Prices, dates, years and quantities are left alone.
 */
export function scrubPii(text: string): ScrubResult {
  const url = replaceCounting(text, URL_RE, '<URL>');
  const email = replaceCounting(url.text, EMAIL_RE, '<EMAIL>');
  const cards = replaceCounting(email.text, LONG_DIGITS_RE, '<ID>');
  const phone = replaceCounting(cards.text, PHONE_RE, '<PHONE>');
  const id = replaceCounting(phone.text, NATIONAL_ID_RE, '<ID>');
  return {
    text: id.text,
    removed: { phone: phone.count, email: email.count, id: id.count + cards.count, url: url.count },
  };
}
