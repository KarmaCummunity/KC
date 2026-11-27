import { assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { identityKey, namesMatch, toDecisionPayload } from './decisionPayload.ts';
import type { IdentityDecision } from './provider.ts';

const APPROVED: IdentityDecision = {
  eventId: 'evt-1', providerSessionId: 'sess-1', attemptId: 'attempt-1', outcome: 'approved', reasonCode: null,
  documentType: 'il_id_card', documentCountry: 'ISR', documentNumber: '12345678-2', documentExpiresOn: '2031-01-01',
  dateOfBirth: '1990-05-05', legalNames: ['Dana', 'Levi'],
};

Deno.test('identityKey ignores spacing, dashes and case', () => {
  assertEquals(identityKey('isr', '12 345-678 2'), 'ISR:123456782');
  assertEquals(identityKey('FRA', 'ab-12'), 'FRA:AB12');
});

Deno.test('namesMatch is a loose word match and unknown when a side is missing', () => {
  assertEquals(namesMatch('Dana L.', ['Dana', 'Levi']), true);
  assertEquals(namesMatch('Dánâ', ['DANA']), true);
  assertEquals(namesMatch('דנה לוי', ['Dana', 'Levi']), false);
  assertEquals(namesMatch(null, ['Dana']), null);
  assertEquals(namesMatch('Dana', []), null);
});

Deno.test('an approval carries a keyed hash and never the document number or name', async () => {
  const payload = await toDecisionPayload(APPROVED, 'hash-key', 'Dana');
  assertMatch(String(payload.identity_hash), /^[0-9a-f]{64}$/);
  assertEquals(payload.outcome, 'approved');
  assertEquals(payload.name_match, true);
  const text = JSON.stringify(payload);
  assertEquals(text.includes('12345678'), false);
  assertEquals(text.includes('Levi'), false);
});

Deno.test('the same document gives the same hash, another key a different one', async () => {
  const a = await toDecisionPayload(APPROVED, 'hash-key', null);
  const b = await toDecisionPayload({ ...APPROVED, documentNumber: '123456782' }, 'hash-key', null);
  const c = await toDecisionPayload(APPROVED, 'other-key', null);
  assertEquals(a.identity_hash, b.identity_hash);
  assertNotEquals(a.identity_hash, c.identity_hash);
});

Deno.test('an approval without a document number goes to review', async () => {
  const payload = await toDecisionPayload({ ...APPROVED, documentNumber: null }, 'hash-key', null);
  assertEquals([payload.outcome, payload.reason_code, payload.identity_hash], ['review', 'document_number_missing', null]);
});

Deno.test('a decline carries no hash', async () => {
  const payload = await toDecisionPayload({ ...APPROVED, outcome: 'declined', reasonCode: 'face_mismatch' }, 'hash-key', null);
  assertEquals([payload.outcome, payload.reason_code, payload.identity_hash], ['declined', 'face_mismatch', null]);
});
