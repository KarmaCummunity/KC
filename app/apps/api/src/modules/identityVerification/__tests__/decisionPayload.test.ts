import { expect, it } from 'vitest';
import { identityKey, namesMatch, toDecisionPayload } from '../decisionPayload';
import type { IdentityDecision } from '../identityProvider';

const APPROVED: IdentityDecision = {
  eventId: 'evt-1', providerSessionId: 'sess-1', attemptId: 'attempt-1', outcome: 'approved', reasonCode: null,
  documentType: 'il_id_card', documentCountry: 'ISR', documentNumber: '12345678-2', documentExpiresOn: '2031-01-01',
  dateOfBirth: '1990-05-05', legalNames: ['Dana', 'Levi'],
};

it('identityKey ignores spacing, dashes and case', () => {
  expect(identityKey('isr', '12 345-678 2')).toEqual('ISR:123456782');
  expect(identityKey('FRA', 'ab-12')).toEqual('FRA:AB12');
});

it('namesMatch is a loose word match and unknown when a side is missing', () => {
  expect(namesMatch('Dana L.', ['Dana', 'Levi'])).toEqual(true);
  expect(namesMatch('Dánâ', ['DANA'])).toEqual(true);
  expect(namesMatch('דנה לוי', ['Dana', 'Levi'])).toEqual(false);
  expect(namesMatch(null, ['Dana'])).toEqual(null);
  expect(namesMatch('Dana', [])).toEqual(null);
});

it('an approval carries a keyed hash and never the document number or name', async () => {
  const payload = toDecisionPayload(APPROVED, 'hash-key', 'Dana');
  expect(String(payload.identity_hash)).toMatch(/^[0-9a-f]{64}$/);
  expect(payload.outcome).toEqual('approved');
  expect(payload.name_match).toEqual(true);
  const text = JSON.stringify(payload);
  expect(text.includes('12345678')).toEqual(false);
  expect(text.includes('Levi')).toEqual(false);
});

it('the same document gives the same hash, another key a different one', async () => {
  const a = toDecisionPayload(APPROVED, 'hash-key', null);
  const b = toDecisionPayload({ ...APPROVED, documentNumber: '123456782' }, 'hash-key', null);
  const c = toDecisionPayload(APPROVED, 'other-key', null);
  expect(a.identity_hash).toEqual(b.identity_hash);
  expect(a.identity_hash).not.toEqual(c.identity_hash);
});

it('an approval without a document number goes to review', async () => {
  const payload = toDecisionPayload({ ...APPROVED, documentNumber: null }, 'hash-key', null);
  expect([payload.outcome, payload.reason_code, payload.identity_hash]).toEqual(['review', 'document_number_missing', null]);
});

it('a decline carries no hash', async () => {
  const payload = toDecisionPayload({ ...APPROVED, outcome: 'declined', reasonCode: 'face_mismatch' }, 'hash-key', null);
  expect([payload.outcome, payload.reason_code, payload.identity_hash]).toEqual(['declined', 'face_mismatch', null]);
});
