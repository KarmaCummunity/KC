import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hmacHex } from './decisionPayload.ts';
import { declineReason, diditProvider, parseDiditWebhook, toDocumentType } from './didit.ts';
import { ProviderError } from './provider.ts';

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

Deno.test('toDocumentType accepts Israeli ID cards and passports of any country only', () => {
  assertEquals(toDocumentType('Identity Card', 'ISR'), 'il_id_card');
  assertEquals(toDocumentType('Passport', 'ISR'), 'il_passport');
  assertEquals(toDocumentType('Passport', 'FRA'), 'foreign_passport');
  assertEquals(toDocumentType('Identity Card', 'FRA'), null);
  assertEquals(toDocumentType("Driver's License", 'ISR'), null);
});

Deno.test('an approval carries the document fields', () => {
  const decision = parseDiditWebhook(webhook('Approved'));
  assertEquals(decision, {
    eventId: 'evt-1', providerSessionId: 'sess-1', attemptId: 'attempt-1', outcome: 'approved', reasonCode: null,
    documentType: 'il_id_card', documentCountry: 'ISR', documentNumber: '123456782', documentExpiresOn: '2031-01-01',
    dateOfBirth: '1990-05-05', legalNames: ['Dana', 'Levi'],
  });
});

Deno.test('an approved document outside v1 is declined', () => {
  const body = webhook('Approved');
  (body.decision.id_verifications[0] as Record<string, unknown>).document_type = "Driver's License";
  const decision = parseDiditWebhook(body);
  assertEquals([decision?.outcome, decision?.reasonCode], ['declined', 'document_not_accepted']);
});

Deno.test('intermediate statuses and foreign bodies change nothing', () => {
  for (const status of ['Not Started', 'In Progress', 'Abandoned', 'Expired', 'Awaiting User']) {
    assertEquals(parseDiditWebhook(webhook(status)), null);
  }
  assertEquals(parseDiditWebhook('nope'), null);
  assertEquals(parseDiditWebhook(webhook('Approved', { session_id: '' })), null);
});

Deno.test('review and resubmit map to their outcomes', () => {
  assertEquals(parseDiditWebhook(webhook('In Review'))?.outcome, 'review');
  assertEquals(parseDiditWebhook(webhook('Resubmitted'))?.reasonCode, 'resubmit_requested');
});

Deno.test('declineReason reads the first error-level warning', () => {
  const warn = (feature: string, risk: string) => ({ warnings: [{ feature, risk, log_type: 'error' }] });
  assertEquals(declineReason({ face_matches: [warn('FACEMATCH', 'LOW_FACE_MATCH_SIMILARITY')] }), 'face_mismatch');
  assertEquals(declineReason({ liveness_checks: [warn('LIVENESS', 'LOW_LIVENESS_SCORE')] }), 'liveness_failed');
  assertEquals(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'DOCUMENT_EXPIRED')] }), 'document_expired');
  assertEquals(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'POSSIBLE_TAMPERING')] }), 'forgery');
  assertEquals(declineReason({ id_verifications: [warn('ID_VERIFICATION', 'BLURRY')] }), 'document_rejected');
  assertEquals(declineReason({ id_verifications: [{ warnings: [{ feature: 'ID_VERIFICATION', risk: 'X', log_type: 'warning' }] }] }),
    'declined_other');
});

Deno.test('verifyWebhook accepts a fresh signature over the raw body, current or previous header', async () => {
  const provider = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w' });
  const raw = JSON.stringify(webhook('Approved'));
  const signature = await hmacHex(SECRET, raw);
  const headers = (extra: Record<string, string>) => new Headers({ 'x-timestamp': String(NOW), ...extra });

  assert(await provider.verifyWebhook(headers({ 'x-signature': signature }), raw, NOW));
  assert(await provider.verifyWebhook(headers({ 'x-signature': 'bad', 'x-signature-previous': signature }), raw, NOW));
  assertEquals(await provider.verifyWebhook(headers({ 'x-signature': signature }), raw + ' ', NOW), false);
  assertEquals(await provider.verifyWebhook(headers({ 'x-signature': signature }), raw, NOW + 301), false);
  assertEquals(await provider.verifyWebhook(new Headers({ 'x-signature': signature }), raw, NOW), false);
});

Deno.test('verifyWebhook fails closed without a secret', async () => {
  const provider = diditProvider({ apiKey: 'k', webhookSecret: '', workflowId: 'w' });
  const raw = '{}';
  // Any signature at all: with no secret configured nothing can verify.
  const headers = new Headers({ 'x-timestamp': String(NOW), 'x-signature': await hmacHex('guess', raw) });
  assertEquals(await provider.verifyWebhook(headers, raw, NOW), false);
});

Deno.test('createSession sends the workflow, attempt id and consent, and returns the hosted URL', async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const provider = diditProvider({
    apiKey: 'key-1', webhookSecret: SECRET, workflowId: 'wf-1',
    fetch: (url, init) => {
      sent = { url: String(url), init: init ?? {} };
      return Promise.resolve(Response.json({ session_id: 'sess-9', url: 'https://verify.didit.me/session/abc' }, { status: 201 }));
    },
  });
  const session = await provider.createSession({ attemptId: 'attempt-9', consentVersion: 'v1', consentGivenAt: '2026-11-18T09:00:00Z', language: 'he' });

  assertEquals(session, { sessionId: 'sess-9', url: 'https://verify.didit.me/session/abc' });
  assertEquals(sent!.url, 'https://verification.didit.me/v3/session/');
  assertEquals((sent!.init.headers as Record<string, string>)['x-api-key'], 'key-1');
  assertEquals(JSON.parse(String(sent!.init.body)), {
    workflow_id: 'wf-1', vendor_data: 'attempt-9', language: 'he',
    biometric_consent: { given_at: '2026-11-18T09:00:00Z', text_version: 'v1' },
  });
});

Deno.test('createSession throws ProviderError on a failed or unusable answer', async () => {
  const failing = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w',
    fetch: () => Promise.resolve(new Response('no', { status: 403 })) });
  await assertRejects(() => failing.createSession({ attemptId: 'a', consentVersion: 'v1', consentGivenAt: 'x', language: 'he' }), ProviderError);
  const insecure = diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w',
    fetch: () => Promise.resolve(Response.json({ session_id: 's', url: 'http://plain.test' })) });
  await assertRejects(() => insecure.createSession({ attemptId: 'a', consentVersion: 'v1', consentGivenAt: 'x', language: 'he' }), ProviderError);
});
