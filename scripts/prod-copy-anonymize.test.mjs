// Tests of the production-copy anonymizer (FR-ADMIN-037 AC5–AC7, AC10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOVED, anonymizeCopy, cleanDeep, cleanText, countsOf, fakeName, keyedUuid, seedEmail,
} from './prod-copy-anonymize.mjs';

const KEY = 'k'.repeat(40);
const OTHER_KEY = 'z'.repeat(40);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('phone numbers in the forms people type are removed (AC6)', () => {
  for (const phone of ['0501234567', '050-1234567', '050-123-4567', '050 123 4567', '(03) 1234567',
    '03-1234567', '+972-50-1234567', '+972501234567', '972 50 123 4567', '+1 415 555 0100']) {
    const out = cleanText(`להתקשר ל ${phone} בערב`);
    assert.ok(!/\d{3}/.test(out), `${phone} → ${out}`);
    assert.ok(out.includes(REMOVED), phone);
  }
});

test('emails, links and ID numbers are removed (AC6)', () => {
  assert.equal(cleanText('כתבו ל-dana.levi+kc@gmail.com'), `כתבו ל-${REMOVED}`);
  assert.equal(cleanText('פרטים: https://example.com/a?b=1 תודה'), `פרטים: ${REMOVED} תודה`);
  assert.equal(cleanText('וואטסאפ wa.me/972501234567'), `וואטסאפ ${REMOVED}`);
  assert.equal(cleanText('ראו www.yad2.co.il'), `ראו ${REMOVED}`);
  assert.equal(cleanText('ת.ז. 123456782'), `ת.ז. ${REMOVED}`);
});

test('ordinary text, prices, dates and times stay as written (AC6)', () => {
  const text = 'ספה במצב טוב, 2 מטר, 150 ש"ח, פנוי מ-05.11.2026 בין 16:00-18:00, דנה';
  assert.equal(cleanText(text), text);
});

test('two numbers in a row collapse into one removal mark', () => {
  assert.equal(cleanText('050-1234567 / 052-7654321'), REMOVED);
});

test('nested details are cleaned, other values kept', () => {
  assert.deepEqual(cleanDeep({ note: 'טל 0501234567', size: 3, tags: ['a@b.co'], ok: true, none: null }),
    { note: `טל ${REMOVED}`, size: 3, tags: [REMOVED], ok: true, none: null });
});

test('keyed ids are stable, version-4 UUIDs, and differ by key and by kind of row (AC7)', () => {
  const id = '6f1c2a3b-0000-4000-8000-000000000001';
  const a = keyedUuid(KEY, 'member', id);
  assert.match(a, UUID_V4);
  assert.equal(keyedUuid(KEY, 'member', id), a);
  assert.notEqual(keyedUuid(OTHER_KEY, 'member', id), a);
  assert.notEqual(keyedUuid(KEY, 'post', id), a);
  assert.notEqual(a, id);
});

test('a member gets a stable fake name and an address on the reserved test domain (AC5)', () => {
  assert.equal(fakeName(KEY, 'm1'), fakeName(KEY, 'm1'));
  assert.match(fakeName(KEY, 'm1'), /^\S+ .+$/u);
  assert.match(seedEmail(KEY, 'm1'), /^prodcopy-[0-9a-f]{20}@seed\.kc\.test$/);
  assert.notEqual(seedEmail(KEY, 'm1'), seedEmail(KEY, 'm2'));
});

const raw = {
  format: 1,
  members: [
    { id: 'm1', city_id: '5000', biography: 'אני דנה, 0501234567', privacy_mode: 'Public', verification_level: 1,
      created_at: '2026-01-01T00:00:00Z', avatar_url: 'https://cdn/x.jpg', phone: '0501234567' },
    { id: 'm2', city_id: '3000', biography: null, privacy_mode: 'Private', verification_level: 0, created_at: '2026-02-01T00:00:00Z' },
  ],
  organizations: [{ id: 'o1', name: 'עמותה', org_type: 'nonprofit_association', contact_email: 'a@b.org',
    public_about_he: 'טלפון 03-1234567' }],
  posts: [{
    id: 'p1', owner_id: 'm1', world_slug: 'rides', kind_slug: 'ride_offer', post_type: 'ride', direction: 'offer',
    status: 'open', title: 'נוסעת לירושלים', description: 'מי שרוצה 052-7654321', details: { note: 'x@y.com' },
    city_id: '5000', created_at: '2026-03-01T00:00:00Z', shown_street: 'הרצל',
    ride: { origin_city_id: '5000', dest_city_id: '3000', seats: 2, notes: 'ליד 0541112222', origin_point: 'POINT(1 2)' },
  }],
  follows: [{ follower_id: 'm1', followed_id: 'm2', created_at: '2026-03-02T00:00:00Z' }],
  saved_posts: [{ user_id: 'm2', post_id: 'p1', saved_at: '2026-03-03T00:00:00Z' }],
};

test('the document keeps its links between rows under the keyed ids', () => {
  const copy = anonymizeCopy(raw, KEY);
  const [m1, m2] = copy.members;
  assert.equal(copy.posts[0].owner_id, m1.id);
  assert.deepEqual([copy.follows[0].follower_id, copy.follows[0].followed_id], [m1.id, m2.id]);
  assert.deepEqual([copy.saved_posts[0].user_id, copy.saved_posts[0].post_id], [m2.id, copy.posts[0].id]);
  assert.deepEqual(countsOf(copy), { members: 2, organizations: 1, posts: 1, follows: 1, saved_posts: 1 });
});

test('no production id, phone, email, photo, street or point survives (AC4–AC7)', () => {
  const text = JSON.stringify(anonymizeCopy(raw, KEY));
  for (const leak of ['"m1"', '"m2"', '"p1"', '"o1"', '0501234567', '052-7654321', '0541112222', '03-1234567',
    'x@y.com', 'a@b.org', 'cdn/x.jpg', 'avatar_url', 'phone', 'contact_email', 'shown_street', 'הרצל',
    'origin_point', 'POINT(']) {
    assert.ok(!text.includes(leak), `leaked ${leak}`);
  }
  assert.equal(anonymizeCopy(raw, KEY).members[1].biography, null);
});

test('a short key or another format is refused before anything is written', () => {
  assert.throws(() => anonymizeCopy(raw, 'short'), /at least 32/);
  assert.throws(() => anonymizeCopy(raw, undefined), /at least 32/);
  assert.throws(() => anonymizeCopy({ ...raw, format: 2 }, KEY), /format 2/);
});
