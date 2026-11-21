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

// Phone separators people type: brackets, dots, dashes including the Hebrew maqaf and other
// unicode dash variants; \s covers non-breaking and unicode spaces.
const SEP = '[\\s().\\-\u05BE\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]*';
const ISRAELI_PHONE = new RegExp(`(?:\\+?972|\\b0)(?:${SEP}\\d){8,9}(?!\\d)`, 'gu');
const INTL_PHONE = new RegExp(`\\+\\d(?:${SEP}\\d){7,}`, 'gu');
// "someone (at) gmail dot com" and friends; only removed when the last dot word is a TLD.
const AT_PAREN = '(?:\\([ \\t]*at[ \\t]*\\)|\\[[ \\t]*at[ \\t]*\\])';
const DOT_FORM = '(?:\\.|\\([ \\t]*dot[ \\t]*\\)|\\[[ \\t]*dot[ \\t]*\\]|[ \\t]+dot[ \\t]+)';
const DOMAIN_PART = `[a-z0-9-]{1,64}(?:[ \\t]*${DOT_FORM}[ \\t]*[a-z0-9-]{1,64})+`;
// Parenthesized/bracketed "at" is a strong obfuscation signal (any local part); a bare
// " at " needs a 3+ char local part so a short ordinary word next to it is not eaten.
const OBFUSCATED_EMAIL = new RegExp(
  `(?<![a-z0-9])(?:[a-z0-9][a-z0-9._%+-]*[ \\t]*${AT_PAREN}[ \\t]*${DOMAIN_PART}|[a-z0-9][a-z0-9._%+-]{2,}[ \\t]+at[ \\t]+${DOMAIN_PART})`, 'giu');

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

/** An obfuscated email only counts when its last dot word is a listed TLD. */
function removeObfuscatedEmail(match) {
  const last = /([a-z]{2,})[^a-z]*$/i.exec(match);
  return last && TLD_SET.has(last[1].toLowerCase()) ? REMOVED : match;
}

/** Replaces contact details and ID numbers in one text with the removal mark (AC6). */
export function cleanText(text) {
  if (typeof text !== 'string') return text ?? null;
  const out = text
    // http(s) links and bare www. links.
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, REMOVED)
    // Email addresses (ASCII, so Hebrew text touching the address is kept).
    .replace(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/giu, REMOVED)
    .replace(OBFUSCATED_EMAIL, removeObfuscatedEmail)
    // Bare domains people paste (wa.me/…, t.me/…, example.co.il, mypage.shop).
    .replace(new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD_LIST})(?![a-z])(?:\\/\\S*)?`, 'giu'), REMOVED)
    // Israeli numbers (050-123 4567, (03) 1234567, +972-50-1234567, 050.123.4567), then
    // international numbers written with a plus; a leading dd.mm.yyyy date stays.
    .replace(ISRAELI_PHONE, removePhone)
    .replace(INTL_PHONE, removePhone)
    // ID numbers, account numbers and any other number of 7+ digits in a row.
    .replace(/\d{7,}/gu, REMOVED);
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
