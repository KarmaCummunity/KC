import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hmacHex } from '../_shared/identity/decisionPayload.ts';
import { diditProvider } from '../_shared/identity/didit.ts';
import { type AppliedEvent, createWebhookHandler, type WebhookHandlerDeps } from './handler.ts';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000;
const APPROVED = {
  event_id: 'evt-1', session_id: 'sess-1', status: 'Approved', vendor_data: '00000000-0000-4000-8000-00000000000a',
  decision: { id_verifications: [{ document_type: 'Identity Card', issuing_state: 'ISR', document_number: '123456782',
    date_of_birth: '1990-05-05', expiration_date: '2031-01-01', first_name: 'Dana', last_name: 'Levi', warnings: [] }] },
};

/** Deps with the real Didit adapter; `apply` records what reached the database. */
function deps(overrides: Partial<WebhookHandlerDeps> = {}, result: AppliedEvent = { id: 'w1', status: 'processed', errorCode: null }) {
  const applied: { slug: string; eventId: string; payload: Record<string, unknown> }[] = [];
  const base: WebhookHandlerDeps = {
    provider: diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w' }),
    identityHashKey: 'hash-key',
    profileNameForAttempt: () => Promise.resolve('Dana'),
    apply: (slug, eventId, payload) => { applied.push({ slug, eventId, payload }); return Promise.resolve(result); },
    nowSeconds: () => NOW,
    report: () => Promise.resolve(),
  };
  return { deps: { ...base, ...overrides }, applied };
}

/** A POST of `body`, signed with `secret` unless it is null. */
async function post(body: unknown, secret: string | null = SECRET) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'x-timestamp': String(NOW) };
  if (secret !== null) headers['x-signature'] = await hmacHex(secret, raw);
  return new Request('http://x/identity-verification-webhook', { method: 'POST', headers, body: raw });
}

Deno.test('a signed approval is applied once with the normalized payload', async () => {
  const { deps: d, applied } = deps();
  const response = await createWebhookHandler(d)(await post(APPROVED));
  assertEquals(response.status, 200);
  assertEquals(applied.length, 1);
  assertEquals([applied[0].slug, applied[0].eventId], ['didit', 'evt-1']);
  const { identity_hash, ...rest } = applied[0].payload;
  assertMatch(String(identity_hash), /^[0-9a-f]{64}$/);
  assertEquals(rest, {
    type: 'identity.decided', provider_session_id: 'sess-1', outcome: 'approved', reason_code: null,
    document_type: 'il_id_card', document_country: 'ISR', document_expires_on: '2031-01-01',
    date_of_birth: '1990-05-05', name_match: true,
  });
});

Deno.test('an unsigned or wrongly signed event is 401 and reaches nothing', async () => {
  const { deps: d, applied } = deps();
  assertEquals((await createWebhookHandler(d)(await post(APPROVED, null))).status, 401);
  assertEquals((await createWebhookHandler(d)(await post(APPROVED, 'other-secret'))).status, 401);
  assertEquals(applied.length, 0);
});

Deno.test('an intermediate status is acknowledged and ignored', async () => {
  const { deps: d, applied } = deps();
  const response = await createWebhookHandler(d)(await post({ ...APPROVED, status: 'In Progress' }));
  assertEquals([response.status, await response.json()], [200, { ok: true, ignored: true }]);
  assertEquals(applied.length, 0);
});

Deno.test('a failed apply is 422 so the provider resends', async () => {
  const { deps: d } = deps({}, { id: 'w1', status: 'failed', errorCode: 'session_not_found' });
  const response = await createWebhookHandler(d)(await post(APPROVED));
  assertEquals(response.status, 422);
  assertEquals((await response.json()).code, 'session_not_found');
});

Deno.test('without the identity hash secret the event fails with 500 and is reported', async () => {
  const reported: unknown[] = [];
  const { deps: d, applied } = deps({ identityHashKey: '', report: (error) => { reported.push(error); return Promise.resolve(); } });
  assertEquals((await createWebhookHandler(d)(await post(APPROVED))).status, 500);
  assertEquals([applied.length, reported.length], [0, 1]);
});
