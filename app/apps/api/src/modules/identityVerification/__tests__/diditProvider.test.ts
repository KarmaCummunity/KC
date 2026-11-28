import { expect, it } from 'vitest';
import { hmacHex } from '../decisionPayload';
import { declineReason, diditProvider, parseDiditWebhook, toDocumentType } from '../diditProvider';
import { ProviderError } from '../identityProvider';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000;

/** A V3 webhook body for `status`, with an Israeli ID card decision. */
function webhook(status: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt-1', webhook_type: 'status.updated', timestamp: NOW, session_id: 'sess-1', status,
    vendor_data: 'attempt-1',
    decision: {
      id_verifications: [{
        status, document_type: 'Identity Card', issuing_state: 'ISR', document_number: '123456782',
        date_of_birth: '1990-05-05', expiration_date: '2031-01-01', first_name: 'Dana', last_name: 'Levi', warnings: [],
      }],
    },
    ...overrides,
  };
}

it('toDocumentType accepts Israeli ID cards and passports of any country only', () => {
  expect(toDocumentType('Identity Card', 'ISR')).toEqual('il_id_card');
  expect(toDocumentType('Passport', 'ISR')).toEqual('il_passport');
  expect(toDocumentType('Passport', 'FRA')).toEqual('foreign_passport');
  expect(toDocumentType('Identity Card', 'FRA')).toEqual(null);
  expect(toDocumentType("Driver's License", 'ISR')).toEqual(null);
});

it('an approval carries the document fields', () => {
  const decision = parseDiditWebhook(webhook('Approved'));
  expect(decision).toEqual({
    eventId: 'evt-1', providerSessionId: 'sess-1', attemptId: 'attempt-1', outcome: 'approved', reasonCode: null,
    documentType: 'il_id_card', documentCountry: 'ISR', documentNumber: '123456782', documentExpiresOn: '2031-01-01',
    dateOfBirth: '1990-05-05', legalNames: ['Dana', 'Levi'],
  });
});

it('an approved document outside v1 is declined', () => {
  const body = webhook('Approved');
  (body.decision.id_verifications[0] as Record<string, unknown>).document_type = "Driver's License";
  const decision = parseDiditWebhook(body);
  expect([decision?.outcome, decision?.reasonCode]).toEqual(['declined', 'document_not_accepted']);
});

it('intermediate statuses and foreign bodies change nothing', () => {
  for (const status of ['Not Started', 'In Progress', 'Abandoned', 'Expired', 'Awaiting User']) {
    expect(parseDiditWebhook(webhook(status))).toEqual(null);
  }
  expect(parseDiditWebhook('nope')).toEqual(null);
  expect(parseDiditWebhook(webhook('constructor'))).toEqual(null);
  expect(parseDiditWebhook(webhook('Approved', { session_id: '' }))).toEqual(null);
});

it('review and resubmit map to their outcomes', () => {
  expect(parseDiditWebhook(webhook('In Review'))?.outcome).toEqual('review');
  expect(parseDiditWebhook(webhook('Resubmitted'))?.reasonCode).toEqual('resubmit_requested');
});

it('declineReason reads the first error-level warning', () => {
  const warn = (feature: string, risk: string) => ({ warnings: [{ feature, risk, log_type: 'error' }] });
  expect(declineReason({ face_matches: [warn('FACEMATCH', 'LOW_FACE_MATCH_SIMILARITY')] })).toEqual('face_mismatch');
  expect(declineReason({ liveness_checks: [warn('LIVENESS', 'LOW_LIVENESS_SCORE')] })).toEqual('liveness_failed');
  expect(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'DOCUMENT_EXPIRED')] })).toEqual('document_expired');
  expect(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'POSSIBLE_TAMPERING')] })).toEqual('forgery');
  expect(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'BLURRY')] })).toEqual('document_rejected');
  expect(declineReason({ id_verifications: [{ warnings: [{ feature: 'ID_VERIFICATION', risk: 'X', log_type: 'warning' }] }] })).toEqual('declined_other');
});

it('verifyWebhook accepts a fresh signature over the raw body, current or previous header', () => {
  const provider = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w' });
  const raw = JSON.stringify(webhook('Approved'));
  const signature = hmacHex(SECRET, raw);
  const headers = (extra: Record<string, string>) => new Headers({ 'x-timestamp': String(NOW), ...extra });

  expect(provider.verifyWebhook(headers({ 'x-signature': signature }), raw, NOW)).toBe(true);
  expect(provider.verifyWebhook(headers({ 'x-signature': 'bad', 'x-signature-previous': signature }), raw, NOW)).toBe(true);
  expect(provider.verifyWebhook(headers({ 'x-signature': signature }), raw + ' ', NOW)).toEqual(false);
  expect(provider.verifyWebhook(headers({ 'x-signature': signature }), raw, NOW + 301)).toEqual(false);
  expect(provider.verifyWebhook(new Headers({ 'x-signature': signature }), raw, NOW)).toEqual(false);
});

it('verifyWebhook fails closed without a secret', () => {
  const provider = diditProvider({ apiKey: 'k', webhookSecret: '', workflowId: 'w' });
  const raw = '{}';
  // Any signature at all: with no secret configured nothing can verify.
  const headers = new Headers({ 'x-timestamp': String(NOW), 'x-signature': hmacHex('guess', raw) });
  expect(provider.verifyWebhook(headers, raw, NOW)).toEqual(false);
});

it('createSession sends the workflow, attempt id and consent, and returns the hosted URL', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const provider = diditProvider({
    apiKey: 'key-1', webhookSecret: SECRET, workflowId: 'wf-1',
    fetch: (url, init) => {
      sent.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(Response.json({ session_id: 'sess-9', url: 'https://verify.didit.me/session/abc' }, { status: 201 }));
    },
  });
  const session = await provider.createSession({ attemptId: 'attempt-9', consentVersion: 'v1', consentGivenAt: '2026-11-18T09:00:00Z', language: 'he' });

  expect(session).toEqual({ sessionId: 'sess-9', url: 'https://verify.didit.me/session/abc' });
  expect(sent[0]?.url).toEqual('https://verification.didit.me/v3/session/');
  expect((sent[0]?.init.headers as Record<string, string>)['x-api-key']).toEqual('key-1');
  expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
    workflow_id: 'wf-1', vendor_data: 'attempt-9', language: 'he',
    biometric_consent: { given_at: '2026-11-18T09:00:00Z', text_version: 'v1' },
  });
});

it('createSession throws ProviderError on a failed or unusable answer', async () => {
  const failing = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w',
    fetch: () => Promise.resolve(new Response('no', { status: 403 })) });
  await expect(failing.createSession({ attemptId: 'a', consentVersion: 'v1', consentGivenAt: 'x', language: 'he' })).rejects.toBeInstanceOf(ProviderError);
  const insecure = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w',
    fetch: () => Promise.resolve(Response.json({ session_id: 's', url: 'http://plain.test' })) });
  await expect(insecure.createSession({ attemptId: 'a', consentVersion: 'v1', consentGivenAt: 'x', language: 'he' })).rejects.toBeInstanceOf(ProviderError);
});

it('sessionConfigured needs nonblank API key and workflow id, not webhook secret', () => {
  for (const [apiKey, workflowId, expected] of [
    ['', 'w', false], ['k', '', false], ['  ', 'w', false], ['k', '  ', false], ['k', 'w', true],
  ] as const) {
    expect(diditProvider({ apiKey, workflowId, webhookSecret: '' }).sessionConfigured).toEqual(expected);
  }
});
