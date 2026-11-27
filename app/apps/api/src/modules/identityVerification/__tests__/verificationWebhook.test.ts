import { describe, expect, it } from 'vitest';
import { hmacHex } from '../decisionPayload';
import { diditProvider } from '../diditProvider';
import { type AppliedEvent, receiveVerificationEvent, type WebhookDeps } from '../verificationWebhook';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000;
const APPROVED = {
  event_id: 'evt-1',
  session_id: 'sess-1',
  status: 'Approved',
  vendor_data: '00000000-0000-4000-8000-00000000000a',
  decision: {
    id_verifications: [
      {
        document_type: 'Identity Card',
        issuing_state: 'ISR',
        document_number: '123456782',
        date_of_birth: '1990-05-05',
        expiration_date: '2031-01-01',
        first_name: 'Dana',
        last_name: 'Levi',
        warnings: [],
      },
    ],
  },
};

/** Dependencies with the real Didit adapter; `apply` records what reached the database. */
function setup(overrides: Partial<WebhookDeps> = {}, result: AppliedEvent = { id: 'w1', status: 'processed', errorCode: null }) {
  const applied: Array<{ slug: string; eventId: string; payload: Record<string, unknown> }> = [];
  const reported: unknown[] = [];
  const deps: WebhookDeps = {
    provider: diditProvider({ apiKey: 'k', webhookSecret: SECRET, workflowId: 'w' }),
    identityHashKey: 'hash-key',
    profileNameForAttempt: () => Promise.resolve('Dana'),
    apply: (slug, eventId, payload) => {
      applied.push({ slug, eventId, payload });
      return Promise.resolve(result);
    },
    nowSeconds: () => NOW,
    report: (error) => reported.push(error),
    ...overrides,
  };
  /** Delivers `body`, signed with `secret` unless it is null. */
  const deliver = (body: unknown, secret: string | null = SECRET) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = new Headers({ 'x-timestamp': String(NOW) });
    if (secret !== null) headers.set('x-signature', hmacHex(secret, raw));
    return receiveVerificationEvent({ headers, rawBody: raw }, deps);
  };
  return { deliver, applied, reported };
}

describe('receiveVerificationEvent', () => {
  it('applies a signed approval once, with the normalized payload and no document number or name', async () => {
    const { deliver, applied } = setup();

    const answer = await deliver(APPROVED);

    expect(answer).toEqual({ status: 200, body: { ok: true, webhook_event_id: 'w1' } });
    expect(applied).toHaveLength(1);
    expect([applied[0]?.slug, applied[0]?.eventId]).toEqual(['didit', 'evt-1']);
    const { identity_hash: identityHash, ...rest } = applied[0]?.payload ?? {};
    expect(String(identityHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(rest).toEqual({
      type: 'identity.decided',
      provider_session_id: 'sess-1',
      outcome: 'approved',
      reason_code: null,
      document_type: 'il_id_card',
      document_country: 'ISR',
      document_expires_on: '2031-01-01',
      date_of_birth: '1990-05-05',
      name_match: true,
    });
    expect(JSON.stringify(applied[0]?.payload)).not.toMatch(/123456782|Levi/);
  });

  it('refuses an unsigned or wrongly signed event with 401; nothing reaches the database', async () => {
    const { deliver, applied } = setup();

    expect((await deliver(APPROVED, null)).status).toBe(401);
    expect((await deliver(APPROVED, 'other-secret')).status).toBe(401);
    expect(applied).toEqual([]);
  });

  it('refuses every event when no webhook secret is configured', async () => {
    const { deliver, applied } = setup({ provider: diditProvider({ apiKey: 'k', webhookSecret: '', workflowId: 'w' }) });

    expect((await deliver(APPROVED, '')).status).toBe(401);
    expect(applied).toEqual([]);
  });

  it('answers 400 for a signed body that is not JSON', async () => {
    const { deliver } = setup();

    expect(await deliver('not json')).toEqual({ status: 400, body: { ok: false, error: 'invalid_event' } });
  });

  it('acknowledges and ignores an intermediate status', async () => {
    const { deliver, applied } = setup();

    expect(await deliver({ ...APPROVED, status: 'In Progress' })).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(applied).toEqual([]);
  });

  it('answers 422 for a failed apply, so the provider resends', async () => {
    const { deliver } = setup({}, { id: 'w1', status: 'failed', errorCode: 'session_not_found' });

    expect(await deliver(APPROVED)).toEqual({ status: 422, body: { ok: false, error: 'event_failed', code: 'session_not_found', webhook_event_id: 'w1' } });
  });

  it('answers 500 and reports when the identity hash secret is missing; nothing is applied', async () => {
    const { deliver, applied, reported } = setup({ identityHashKey: null });

    expect((await deliver(APPROVED)).status).toBe(500);
    expect([applied.length, reported.length]).toEqual([0, 1]);
  });
});
