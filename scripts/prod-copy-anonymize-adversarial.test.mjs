#!/usr/bin/env node
// Adversarial synthetic qualification for the prod-copy anonymizer (FR-ADMIN-037, #2487).
// ADDITIVE to scripts/prod-copy-anonymize.test.mjs — that suite's coverage is untouched.
//
//   • GUARDS — patterns AC6 says are removed must actually be removed (exact expected
//     output asserted, not merely absence of the original string), including the hardened
//     forms: dot-separated phones, unicode separator variants, broader TLDs, obfuscated
//     emails, details keys, and numeric-typed details values, with date/price false-positive
//     guards and deterministic key-collision qualification.
//   • RESIDUALS — measurements of what the hardened patterns still keep, documented not
//     endorsed. The real-text/precise-time/relationship retention tradeoff is an owner/spec
//     decision.
// All fixtures are synthetic. No production data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeCopy, cleanText, cleanDeep, REMOVED, keyedUuid } from './prod-copy-anonymize.mjs';

const KEY = 'k'.repeat(32);
const has = (text, needle) => String(text).includes(needle);

test('GUARD: covered contact patterns are fully removed (exact expected output)', () => {
  assert.equal(cleanText('mail someone@gmail.com please'), `mail ${REMOVED} please`);
  assert.equal(cleanText('call 050-123 4567 now'), `call ${REMOVED} now`);
  assert.equal(cleanText('id 123456789 end'), `id ${REMOVED} end`);
  assert.equal(cleanText('see https://kc.example.com/x ok'), `see ${REMOVED} ok`);
  assert.equal(cleanText('go example.co.il now'), `go ${REMOVED} now`);
});

test('GUARD: nested details values are scrubbed deeply, structure and non-strings untouched', () => {
  const cleaned = cleanDeep({ a: { b: ['call 0501234567', 42, null, { c: 'x@y.com' }] }, n: 7 });
  assert.deepEqual(cleaned, { a: { b: [`call ${REMOVED}`, 42, null, { c: REMOVED }] }, n: 7 });
});

test('GUARD: keyed ids are stable and namespaced pseudonyms, never embedding the raw id (AC7)', () => {
  const a1 = keyedUuid(KEY, 'member', 'real-id-1');
  assert.equal(a1, keyedUuid(KEY, 'member', 'real-id-1'));
  assert.notEqual(a1, keyedUuid(KEY, 'member', 'real-id-2'));
  assert.notEqual(a1, keyedUuid(KEY, 'post', 'real-id-1'));
  assert.ok(!has(a1, 'real-id-1'));
  assert.match(a1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('GUARD: output drops non-format fields (defense against export column drift)', () => {
  const raw = {
    format: 1,
    members: [{ id: 'm1', email: 'real@x.com', display_name: 'Real Name', phone: '0501234567',
      city_id: 'c', biography: 'b', privacy_mode: 'public', verification_level: 'basic',
      created_at: '2026-01-01', password_hash: 'LEAK-ME-NOT' }],
    organizations: [], posts: [], follows: [], saved_posts: [],
  };
  const m = anonymizeCopy(raw, KEY).members[0];
  assert.ok(!('password_hash' in m));
  assert.ok(!('phone' in m));
  assert.ok(has(m.email, '@seed.kc.test'));
  assert.ok(!has(m.email, 'real@x.com'));
});

test('GUARD: dot phones removed; only exact valid date spans protected, attached digits redacted', () => {
  assert.equal(cleanText('call me on 050.123.4567 anytime'), `call me on ${REMOVED} anytime`);
  assert.equal(cleanText('פנוי מ-05.11.2026'), 'פנוי מ-05.11.2026');
  // A time glued to a real date is not part of the date span: the remainder is redacted.
  assert.equal(cleanText('מ-05.11.2026 14.30'), `מ-05.11.2026${REMOVED}.30`);
  // A phone after a real date is caught on its own, not sheltered by the date prefix.
  assert.equal(cleanText('x 05.11.2026 0501234567'), `x 05.11.2026 ${REMOVED}`);
  // Impossible calendar dates are not protected (and too short to match anyway).
  assert.equal(cleanText('date 05.13.2026 end'), 'date 05.13.2026 end');
  assert.equal(cleanText('date 31.02.2026 end'), 'date 31.02.2026 end');
});

test('GUARD: unicode separator variants (maqaf, en-dash, nbsp) are removed as phones', () => {
  assert.equal(cleanText('call 050־123־4567 now'), `call ${REMOVED} now`);
  assert.equal(cleanText('call 050–123–4567 now'), `call ${REMOVED} now`);
  assert.equal(cleanText('call 050 123 4567 now'), `call ${REMOVED} now`);
});

test('RESIDUAL: phone numbers written in Hebrew words survive (lexical scrub)', () => {
  assert.ok(has(cleanText('הטלפון שלי הוא אפס חמש אפס אחת שתיים שלוש ארבע חמש שש שבע'), 'אפס חמש אפס'));
});

test('GUARD: bare domains beyond the original TLD shortlist are removed', () => {
  assert.equal(cleanText('find me on mypage.app or mypage.dev or mypage.shop'),
    `find me on ${REMOVED} or ${REMOVED} or ${REMOVED}`);
  assert.equal(cleanText('a listed TLD must not eat a longer word: mypage.apples'),
    'a listed TLD must not eat a longer word: mypage.apples');
});

test('GUARD: obfuscated emails - zero-width, parenthesized, adjacency, bounded TLD', () => {
  assert.equal(cleanText('someone(at)gmail.com'), REMOVED);
  assert.equal(cleanText('mail someone (at) gmail [dot] com now'), `mail ${REMOVED} now`);
  assert.equal(cleanText('mail me at someone (at) gmail.com'), `mail me at ${REMOVED}`);
  assert.equal(cleanText('mail someone at gmail dot com please'), `mail ${REMOVED} please`);
  assert.equal(cleanText('meet at noon for coffee'), 'meet at noon for coffee');
  // A bare " at " with a 1-2 char local part is treated as ordinary words, not an email.
  assert.equal(cleanText('me at gmail dot com'), 'me at gmail dot com');
  // An unlisted final dot word is a known residual: bounded TLD coverage, not universal.
  assert.ok(has(cleanText('mail someone at gmail dot xyzzy ok'), 'xyzzy'));
});

test('GUARD: details keys scrubbed; special own keys and pre-qualified names preserve every value', () => {
  assert.ok(!has(JSON.stringify(cleanDeep({ 'contact_0501234567': 'ok' })), '0501234567'));
  assert.deepEqual(cleanDeep({ '050-1234567': 'a', '052-7654321': 'b' }),
    { [REMOVED]: 'a', [`${REMOVED} (2)`]: 'b' });
  // JSON.parse fixtures: __proto__/constructor stay real own properties (no prototype
  // mutation, no dropped field); a key already named like the mark qualifies further.
  const raw = JSON.parse('{"__proto__": {"polluted": false}, "constructor": 1, "050-1234567": "a", "052-7654321": "b", "[הוסר]": "pre"}');
  const out = cleanDeep(raw);
  assert.ok(Object.prototype.hasOwnProperty.call(out, '__proto__'));
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(Object.keys(out), ['__proto__', 'constructor', REMOVED, `${REMOVED} (2)`, `${REMOVED} (3)`]);
  assert.deepEqual(Object.values(out), [{ polluted: false }, 1, 'a', 'b', 'pre']);
});

test('GUARD: typed integers of 7+ digits removed like text; smaller numbers stay, no currency exemption', () => {
  assert.deepEqual(cleanDeep({ contact: 501234567, count: 42, code: 123456, price: 1234567.89 }),
    { contact: REMOVED, count: 42, code: 123456, price: 1234567.89 });
  assert.equal(cleanText('₪1000000 deal'), `₪${REMOVED} deal`);
  assert.equal(cleanText('cost 1000000 ש"ח total'), `cost ${REMOVED} ש"ח total`);
  assert.equal(cleanText('id 1234567 end'), `id ${REMOVED} end`);
});

test('RESIDUAL: short numeric identifiers (under 7 digits) survive', () => {
  const cleaned = cleanText('apartment 12, code 123456');
  assert.ok(has(cleaned, '123456') && has(cleaned, '12'));
});

test('RESIDUAL: free text keeps names and content by design (AC6 intended retention)', () => {
  const cleaned = cleanText('משה כהן needs a ride to Jerusalem tomorrow morning');
  assert.ok(has(cleaned, 'משה כהן') && has(cleaned, 'Jerusalem'));
});

test('RESIDUAL: precise timestamps, city and social linkage are retained by format', () => {
  const raw = {
    format: 1,
    members: [{ id: 'm1', email: 'a@b.com', display_name: 'N', city_id: 'tel-aviv', biography: null,
      privacy_mode: 'public', verification_level: 'basic', created_at: '2026-01-01T00:00:00Z' }],
    organizations: [],
    posts: [{ id: 'p1', owner_id: 'm1', world_slug: 'rides', kind_slug: 'ride', post_type: 'offer',
      direction: 'offer', status: 'open', title: 't', description: 'd', details: {},
      city_id: 'tel-aviv', created_at: '2026-01-02T00:00:00Z', published_at: '2026-01-02T01:00:00Z',
      ride: { origin_city_id: 'tel-aviv', dest_city_id: 'haifa', departs_at: '2026-02-01T08:00:00Z' } }],
    follows: [{ follower_id: 'm1', followed_id: 'm1', created_at: '2026-01-03T00:00:00Z' }],
    saved_posts: [],
  };
  const copy = anonymizeCopy(raw, KEY);
  // Stable keyed pseudonyms plus verbatim city/timestamps/relationships make cross-week
  // linkage possible by design (AC7); this is the owner-level policy tradeoff, not a bug claim.
  assert.equal(copy.posts[0].ride.departs_at, '2026-02-01T08:00:00Z');
  assert.equal(copy.posts[0].city_id, 'tel-aviv');
  assert.equal(copy.follows[0].created_at, '2026-01-03T00:00:00Z');
  assert.equal(copy.members[0].id, anonymizeCopy(raw, KEY).members[0].id);
});
