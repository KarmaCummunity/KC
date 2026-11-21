#!/usr/bin/env node
// Production copy (FR-ADMIN-037) · the anonymizer.
//
// Runs inside the weekly job's kc-prod step, right after scripts/prod-copy-export.sql, on the
// raw export. It writes the document kc-dev receives (supabase/seed/prod-copy, format 1):
//   • every id is replaced by a keyed id (HMAC-SHA256 with PROD_COPY_ID_KEY): the same
//     production row always maps to the same kc-dev row, and nobody without the key can map a
//     kc-dev id back (AC7);
//   • members get a fake Hebrew name and a seed-domain address; no photo, phone or date of
//     birth exists in the input at all (AC5);
//   • phone numbers, email addresses, links and ID numbers are removed from every free-text
//     field, nested `details` included (AC6);
//   • every output object is rebuilt field by field, so a column added to the export by mistake
//     is dropped here too.
// It prints counts only, never a name, a text or an id (AC10).
//
// Usage: PROD_COPY_ID_KEY=<secret> node scripts/prod-copy-anonymize.mjs <raw.json> <copy.json>

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Hebrew words (the removal mark, the fake names) live with the other copy data under
// supabase/seed/prod-copy, the place the repository keeps Hebrew seed text.
const WORDS = JSON.parse(readFileSync(new URL('../supabase/seed/prod-copy/anonymizer-words.json', import.meta.url), 'utf8'));
const FIRST_NAMES = WORDS.first_names;
const LAST_NAMES = WORDS.last_names;

export const FORMAT = 1;
/** What a removed phone number, address, link or ID number becomes in the copied text. */
export const REMOVED = WORDS.removed_mark;
/** The id key must be long enough that guessing it is not an option. */
export const MIN_KEY_LENGTH = 32;


// Free-text patterns removed by AC6. Order matters: links and addresses first, so the digits
// inside them are not left half-removed; obfuscated emails run before bare domains so the
// local part is not left behind.

// TLDs recognized in bare domains and obfuscated emails: broad but listed, so an ordinary
// word after a dot (a sentence boundary, a version number) is not eaten. (?![a-z]) stops a
// listed TLD matching as a prefix of a longer word.
const TLD_LIST = 'com|net|org|il|me|ly|io|co|info|biz|app|dev|pro|shop|site|online|club|cc|tv|ai|xyz|link|live|chat|page|store|tech|today|world|city|fund|give|care|help|life|fit|blog|news|media|network|services|digital|community|support|agency|center|social|one|group';
const TLD_SET = new Set(TLD_LIST.split('|'));

// Phone separators people type: brackets, dots, slashes, dashes including the Hebrew maqaf,
// other unicode dash variants and zero-width characters; \s covers non-breaking and unicode
// spaces. A dd/mm/yyyy date is 8 digits, so it never reaches the 9-10 digits the phone
// patterns require.
const SEP = '[\\s()./\\-\u05BE\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u200B\u200C\u200D\uFEFF]*';
const ISRAELI_PHONE = new RegExp(`(?:\\+?972|\\b0)(?:${SEP}\\d){8,9}(?!\\d)`, 'gu');
const INTL_PHONE = new RegExp(`\\+\\d(?:${SEP}\\d){7,}`, 'gu');
// Zero-width characters people hide inside obfuscated addresses so a plain pattern misses
// them; SP is the spacing class around the at/dot words (spaces, tabs and zero-widths).
const ZW = '\\u200B\\u200C\\u200D\\uFEFF';
const SP = `[ \\t${ZW}]`;
// "someone (at) gmail dot com" and friends; only removed when the last dot word is a TLD.
const AT_PAREN = `(?:\\(${SP}*at${SP}*\\)|\\[${SP}*at${SP}*\\])`;
const DOT_FORM = `(?:\\.|\\(${SP}*dot${SP}*\\)|\\[${SP}*dot${SP}*\\]|${SP}+dot${SP}+)`;
const DOMAIN_PART = `[a-z0-9-]{1,64}(?:${SP}*${DOT_FORM}${SP}*[a-z0-9-]{1,64})+`;
// Parenthesized/bracketed "at" is a strong obfuscation signal (any local part); a bare
// " at " needs a 3+ char local part so a short ordinary word next to it is not eaten.
// The plain email pattern above misses addresses whose owner hid zero-width characters in
// the local part, around the @ or inside the domain. This tolerant candidate allows ZW
// anywhere in the token and counts only when stripping it leaves a real email.
const ZW_CLASS = ZW;
const EMAIL_PLAIN = new RegExp('^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\\.[a-z]{2,}$', 'iu');
const EMAIL_ZW = new RegExp(
  `(?<![a-z0-9])[a-z0-9](?:[a-z0-9._%+-]|[${ZW_CLASS}])*@[${ZW_CLASS}]*(?:[a-z0-9-]|[${ZW_CLASS}])+(?:\\.(?:[a-z0-9-]|[${ZW_CLASS}])+)+`, 'giu');

/** An email with zero-width obfuscation counts when, ZW stripped, it is a plain email. */
function removeEmailZw(match) {
  return EMAIL_PLAIN.test(match.replace(new RegExp(`[${ZW_CLASS}]`, 'gu'), '')) ? REMOVED : match;
}

const OBFUSCATED_EMAIL = new RegExp(
  `(?<![a-z0-9])(?:[a-z0-9][a-z0-9._%+-]*${SP}*${AT_PAREN}${SP}*${DOMAIN_PART}|[a-z0-9][a-z0-9._%+-]{2,}${SP}+at${SP}+${DOMAIN_PART})`, 'giu');

/** The longest leading dd.mm.yyyy span of a candidate that is a real calendar date, else null. */
function validDateSpan(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (!m) return null;
  const day = +m[1], month = +m[2], year = +m[3];
  if (year < 1900 || year > 2099 || month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return m[0];
}

/** Only an exact valid date span is protected; any digits glued to it are still removed. */
function removePhone(match) {
  const span = validDateSpan(match);
  if (!span) return REMOVED;
  return /\d/.test(match.slice(span.length)) ? span + REMOVED : match;
}

// A real-calendar dd.mm.yyyy date, optionally followed by an hh:mm / hh.mm time. Valid spans
// are replaced by placeholders before any removal runs, so a date and its time survive whole
// instead of the phone pattern eating the hour. Digits next to a date are still caught.
const DATE_SPAN = /\b\d{1,2}\.\d{1,2}\.\d{4}(?:[ \t]+\d{1,2}[:.]\d{2})?/gu;

/** Replaces every valid date(-time) span with a placeholder; returns [text, spans]. The
 *  optional time is protected only when it is a real hh:mm / hh.mm; an invalid one stays
 *  visible to the number patterns. */
function protectDates(text) {
  const spans = [];
  const out = text.replace(DATE_SPAN, (match) => {
    const date = validDateSpan(match);
    if (!date) return match; // an impossible calendar date is not protected
    const rest = match.slice(date.length);
    const tm = /^[ \t]+(\d{1,2})[:.](\d{2})$/.exec(rest);
    const span = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? match : date;
    spans.push(span);
    return `\u0001${spans.length - 1}\u0001` + match.slice(span.length);
  });
  return [out, spans];
}

/** Restores the placeholders protectDates planted. */
function restoreDates(text, spans) {
  return text.replace(/\u0001(\d+)\u0001/g, (_, i) => spans[Number(i)]);
}

/** A comma-grouped run is removed only when it holds 7+ digits, the same policy as \d{7,}:
 *  "1,234,567" and "050,123,4567" go, "2,026" and "1,23" stay. */
function removeCommaNumber(match) {
  return match.replace(/\D/g, '').length >= 7 ? REMOVED : match;
}

/** A bare domain is removed in any casing (MYPAGE.APP, MyPage.App), except the one shape
 *  that is also an ordinary sentence boundary: a single all-lowercase alphabetic word, a
 *  period, then a Capitalized word that starts the next sentence ("see you.Today"). A match
 *  with a path (word.Today/x) is a link, not a sentence, and a base with digits or hyphens
 *  is not an ordinary word: both go. That single ambiguous shape keeps its text; every
 *  other casing still goes. */
function removeBareDomain(match) {
  // A port, path, query or fragment means a link, never a sentence boundary.
  if (/[:/?#]/.test(match)) return REMOVED;
  const dot = match.lastIndexOf('.');
  const base = match.slice(0, dot);
  const tld = match.slice(dot + 1);
  const sentenceLike = /^[a-z]+$/.test(base) && /^[A-Z][a-z]+$/.test(tld);
  return sentenceLike ? match : REMOVED;
}

/** An obfuscated email only counts when its last dot word is a listed TLD. */
function removeObfuscatedEmail(match) {
  const last = /([a-z]{2,})[^a-z]*$/i.exec(match);
  return last && TLD_SET.has(last[1].toLowerCase()) ? REMOVED : match;
}

/** Replaces contact details and ID numbers in one text with the removal mark (AC6). */
export function cleanText(text) {
  if (typeof text !== 'string') return text ?? null;
  const [dated, dates] = protectDates(text);
  let out = dated
    // http(s) links and bare www. links.
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, REMOVED)
    // Email addresses (ASCII, so Hebrew text touching the address is kept). The
    // zero-width-tolerant form runs first: a plain match starting after a hidden zero-width
    // would otherwise eat only the tail and leave the local identity fragment behind.
    .replace(EMAIL_ZW, removeEmailZw)
    .replace(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/giu, REMOVED)
    .replace(OBFUSCATED_EMAIL, removeObfuscatedEmail)
    // Bare domains people paste (wa.me/…, t.me/…, example.co.il, mypage.shop), including a
    // numeric port, a root slash, a path, a query or a fragment (mypage.app:8080/x,
    // mypage.app/, mypage.app?q=…, mypage.app#…): explicit URL shapes, so the whole token is
    // consumed. A lone trailing "?"/"#" followed by a space is punctuation, so those need at
    // least one non-space character; a root "/" alone already makes it a link.
    .replace(new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD_LIST})(?![a-z])(?::\\d+)?(?:\\/\\S*|[?#]\\S+)?`, 'giu'), removeBareDomain)
    // Israeli numbers (050-123 4567, (03) 1234567, +972-50-1234567, 050.123.4567,
    // 050/123/4567), then international numbers written with a plus; protected dates stay.
    .replace(ISRAELI_PHONE, removePhone)
    .replace(INTL_PHONE, removePhone)
    // Numbers grouped with commas follow the same 7+ digit policy as plain digit runs.
    .replace(/(?<![\d,])\d+(?:,\d+)+(?![\d,])/gu, removeCommaNumber)
    // ID numbers, account numbers and any other run of 7+ digits, zero-widths included.
    .replace(new RegExp(`\\d(?:[${ZW_CLASS}]*\\d){6,}`, 'gu'), REMOVED);
  out = restoreDates(out, dates);
  // "050-1234567 / 052-7654321" leaves two marks and a slash: keep one mark.
  return out.replace(new RegExp(`${escapeRegExp(REMOVED)}(?:[\\s/,;|-]*${escapeRegExp(REMOVED)})+`, 'gu'), REMOVED);
}

/** cleanText applied to every string inside a JSON value (the free-form `details` object). */
export function cleanDeep(value) {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number') {
    // Same policy as free text: an integer of 7+ digits is an ID/account/phone even typed
    // as a number; smaller counts, sizes and prices stay.
    return Number.isInteger(value) && Math.abs(value) >= 1e6 ? REMOVED : value;
  }
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === 'object') {
    // Keys are free text too and carry contact data; scrub them as well. defineProperty keeps
    // special own keys (__proto__, constructor, prototype) as real own properties instead of
    // mutating the prototype or dropping the field. Two keys can scrub to the same name (two
    // different phones, or a key already named like the mark): qualify the later one
    // deterministically instead of blindly overwriting the earlier value.
    const out = {};
    const used = new Set();
    for (const [k, v] of Object.entries(value)) {
      let nk = cleanText(k);
      if (used.has(nk)) {
        let n = 2;
        while (used.has(`${nk} (${n})`)) n += 1;
        nk = `${nk} (${n})`;
      }
      used.add(nk);
      Object.defineProperty(out, nk, { value: cleanDeep(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** HMAC-SHA256 of `${purpose}:${value}` under the id key. */
function mac(key, purpose, value) {
  return createHmac('sha256', key).update(`${purpose}:${value}`).digest();
}

/**
 * The kc-dev id of a production row: a version-4 UUID built from the keyed hash, so it is
 * stable across runs and cannot be traced back without the key (AC7).
 */
export function keyedUuid(key, namespace, id) {
  const bytes = mac(key, `id:${namespace}`, id).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fake Hebrew name, the same one every week for the same member (AC5). */
export function fakeName(key, memberId) {
  const bytes = mac(key, 'name', memberId);
  return `${FIRST_NAMES[bytes.readUInt16BE(0) % FIRST_NAMES.length]} ${LAST_NAMES[bytes.readUInt16BE(2) % LAST_NAMES.length]}`;
}

/** The member's sign-in address: the reserved .test domain, which no mail server serves (AC5). */
export function seedEmail(key, memberId) {
  return `prodcopy-${mac(key, 'email', memberId).toString('hex').slice(0, 20)}@seed.kc.test`;
}

/** Builds the document kc-dev receives from the raw export. Throws on a bad key or format. */
export function anonymizeCopy(raw, key) {
  if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH) {
    throw new Error(`PROD_COPY_ID_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  }
  if (raw?.format !== FORMAT) throw new Error(`raw export format ${raw?.format} is not ${FORMAT}`);
  const member = (id) => keyedUuid(key, 'member', id);
  const post = (id) => keyedUuid(key, 'post', id);
  const list = (rows) => (Array.isArray(rows) ? rows : []);

  return {
    format: FORMAT,
    members: list(raw.members).map((m) => ({
      id: member(m.id),
      email: seedEmail(key, m.id),
      display_name: fakeName(key, m.id),
      city_id: m.city_id ?? null,
      biography: cleanText(m.biography),
      privacy_mode: m.privacy_mode,
      verification_level: m.verification_level,
      created_at: m.created_at,
    })),
    organizations: list(raw.organizations).map((o) => ({
      id: keyedUuid(key, 'organization', o.id),
      name: cleanText(o.name),
      org_type: o.org_type ?? null,
      city_id: o.city_id ?? null,
      is_verified_nonprofit: Boolean(o.is_verified_nonprofit),
      public_tagline_he: cleanText(o.public_tagline_he),
      public_tagline_en: cleanText(o.public_tagline_en),
      public_about_he: cleanText(o.public_about_he),
      public_about_en: cleanText(o.public_about_en),
    })),
    posts: list(raw.posts).map((p) => anonymizePost(p, member, post)),
    follows: list(raw.follows).map((f) => ({
      follower_id: member(f.follower_id), followed_id: member(f.followed_id), created_at: f.created_at,
    })),
    saved_posts: list(raw.saved_posts).map((s) => ({
      user_id: member(s.user_id), post_id: post(s.post_id), saved_at: s.saved_at,
    })),
  };
}

/** One post: keyed ids, cleaned text, and only the world-row fields kc-dev reads. */
function anonymizePost(p, member, post) {
  const pick = (row, fields) => (row ? Object.fromEntries(fields.map((f) => [f, row[f] ?? null])) : null);
  return {
    id: post(p.id),
    owner_id: member(p.owner_id),
    world_slug: p.world_slug,
    kind_slug: p.kind_slug,
    item_subcategory_slug: p.item_subcategory_slug ?? null,
    post_type: p.post_type,
    direction: p.direction,
    status: p.status,
    title: cleanText(p.title),
    description: cleanText(p.description),
    details: cleanDeep(p.details ?? {}),
    city_id: p.city_id,
    time_window: p.time_window ?? null,
    urgency_level: p.urgency_level ?? null,
    expires_at: p.expires_at ?? null,
    source_language: p.source_language ?? null,
    published_at: p.published_at ?? null,
    created_at: p.created_at,
    ride: p.ride && {
      ...pick(p.ride, ['origin_city_id', 'dest_city_id', 'departs_at', 'arrives_at', 'seats', 'luggage',
        'cargo_items', 'cargo_food', 'reward_model', 'cost_share_ils']),
      notes: cleanText(p.ride.notes),
    },
    event: pick(p.event, ['starts_at', 'ends_at', 'capacity', 'registration_policy', 'counts_volunteer_hours']),
    food: pick(p.food, ['expires_at', 'food_type', 'allergens', 'kosher', 'dietary_tags']),
    housing: pick(p.housing, ['place_type', 'capacity', 'exclusive', 'min_nights', 'max_nights', 'check_in_from',
      'check_in_until', 'check_out_by', 'children_ok', 'pets_ok', 'available_from', 'available_until',
      'available_weekdays', 'blackout_dates']),
  };
}

/** Counts of a document, the only thing the job prints (AC10). */
export function countsOf(copy) {
  return Object.fromEntries(
    ['members', 'organizations', 'posts', 'follows', 'saved_posts'].map((k) => [k, copy[k].length]));
}

function main([input, output]) {
  if (!input || !output) {
    console.error('usage: PROD_COPY_ID_KEY=… node scripts/prod-copy-anonymize.mjs <raw.json> <copy.json>');
    process.exit(2);
  }
  const copy = anonymizeCopy(JSON.parse(readFileSync(input, 'utf8')), process.env.PROD_COPY_ID_KEY);
  writeFileSync(output, JSON.stringify(copy), { mode: 0o600 });
  console.log(JSON.stringify(countsOf(copy)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
