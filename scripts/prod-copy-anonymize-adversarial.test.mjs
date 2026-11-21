#!/usr/bin/env node
// Adversarial synthetic qualification for the prod-copy anonymizer (FR-ADMIN-037, #2487).
// ADDITIVE to scripts/prod-copy-anonymize.test.mjs — that suite's coverage is untouched.
//
//   • GUARDS — patterns AC6 says are removed must actually be removed (exact expected
//     output asserted, not merely absence of the original string).
//   • RESIDUALS — measurements of what the current patterns keep, documented not endorsed.
//     Tightening them is a technical hardening change handled separately; the
//     real-text/precise-time/relationship retention tradeoff is an owner/spec decision.
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

test('RESIDUAL: dot-separated phone numbers survive (pattern excludes dot separators)', () => {
  assert.ok(has(cleanText('call me on 050.123.4567 anytime'), '050.123.4567'));
});

test('RESIDUAL: phone numbers written in Hebrew words survive (lexical scrub)', () => {
  assert.ok(has(cleanText('הטלפון שלי הוא אפס חמש אפס אחת שתיים שלוש ארבע חמש שש שבע'), 'אפס חמש אפס'));
});

test('RESIDUAL: bare domains outside the listed TLDs survive (.app/.dev/.shop)', () => {
  const cleaned = cleanText('find me on mypage.app or mypage.dev or mypage.shop');
  assert.ok(has(cleaned, 'mypage.app') && has(cleaned, 'mypage.dev') && has(cleaned, 'mypage.shop'));
});

test('RESIDUAL: obfuscated email local parts survive when only the domain is scrubbed', () => {
  assert.ok(has(cleanText('mail me at someone (at) gmail.com'), 'someone (at)'));
});

test('RESIDUAL: contact data inside details KEYS survives (only values are scrubbed)', () => {
  assert.ok(has(JSON.stringify(cleanDeep({ 'contact_0501234567': 'ok' })), '0501234567'));
});

test('RESIDUAL: numeric-typed contact values inside details survive (only strings are scrubbed)', () => {
  const cleaned = cleanDeep({ contact: 501234567 });
  assert.equal(cleaned.contact, 501234567);
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
