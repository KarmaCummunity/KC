import 'reflect-metadata';
import type { IIdentityVerificationService } from '@kc/application';
import { BackendRuleError } from '@kc/domain';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacHex } from '../../modules/identityVerification/decisionPayload';
import { diditProvider } from '../../modules/identityVerification/diditProvider';
import { KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';
import { testConfig } from '../support/testConfig';

const WEBHOOK_SECRET = 'whsec_integration';
const WEBHOOK_URL = '/v1/webhooks/identity-verification';
const HOSTED_URL = 'https://verify.example.test/session/1';

/**
 * Identity verification end to end (FR-VERIFY-005): consent and the session
 * through the gateway, the decision through the webhook route, both down to
 * the real KC schema. The real provider adapter runs; only its outbound call
 * is a stand-in.
 */
describe('Identity verification on the KC schema', () => {
  const database = new KcTestDatabase();
  /** The attempt ids the stand-in provider was asked to open sessions for. */
  const sessionRequests: string[] = [];
  let gateway: KcGateway;
  let baseUrl: string;

  const verificationOf = (userId: string) =>
    createRemotePort<IIdentityVerificationService>(createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(userId) }), 'identityVerification');
  /** Delivers a provider event the way the provider does: the raw body, signed with the shared secret. */
  const deliver = (event: Record<string, unknown>, secret = WEBHOOK_SECRET) => {
    const raw = JSON.stringify(event);
    return gateway.app.inject({
      method: 'POST',
      url: WEBHOOK_URL,
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-signature': hmacHex(secret, raw) },
    });
  };
  /** An approval of an Israeli identity card for the attempt, as the provider reports it. */
  const approval = (attemptId: string, documentNumber: string, eventId: string) => ({
    event_id: eventId,
    session_id: `sess-${attemptId}`,
    status: 'Approved',
    vendor_data: attemptId,
    decision: {
      id_verifications: [
        { document_type: 'Identity Card', issuing_state: 'ISR', document_number: documentNumber, date_of_birth: '1990-05-05', expiration_date: '2031-01-01', first_name: 'Dana', last_name: 'Levi', warnings: [] },
      ],
    },
  });
  /** A member who consented and opened a session; returns the attempt the provider was given. */
  const memberWithSession = async () => {
    const member = await database.newMember();
    await verificationOf(member.userId).acceptConsent('v1');
    const session = await verificationOf(member.userId).startSession();
    return { member, session, attemptId: sessionRequests.at(-1) as string };
  };
  /** A document number no earlier run used: one document verifies one account. */
  const freshDocumentNumber = () => String(Date.now()).slice(-9).padStart(9, '1');

  beforeAll(async () => {
    const provider = diditProvider({
      apiKey: 'test-key',
      webhookSecret: WEBHOOK_SECRET,
      workflowId: 'workflow-1',
      fetch: (_url, init) => {
        const { vendor_data: attemptId } = JSON.parse(String(init?.body)) as { vendor_data: string };
        sessionRequests.push(attemptId);
        return Promise.resolve(Response.json({ session_id: `sess-${attemptId}`, url: HOSTED_URL }, { status: 201 }));
      },
    });
    gateway = await startKcGateway({
      identityProvider: provider,
      config: { identityVerification: { ...testConfig().identityVerification, identityHashKey: 'integration-hash-key' } },
    });
    baseUrl = await gateway.listen();
  });

  afterAll(async () => {
    await gateway?.app.close();
    await database.close();
  });

  it('takes a member from consent to verified: the session by the gateway, the decision by the signed webhook', async () => {
    const { member, session, attemptId } = await memberWithSession();
    const inProgress = await verificationOf(member.userId).getStatus();

    const response = await deliver(approval(attemptId, freshDocumentNumber(), `evt-${attemptId}`));
    const verified = await verificationOf(member.userId).getStatus();
    const stored = await database.admin.query<{ provider: string; status: string }>('select provider, status from public.identity_verifications where id = $1', [attemptId]);

    expect(session).toEqual({ hostedUrl: HOSTED_URL });
    expect(inProgress.status).toBe('in_progress');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(verified.status).toBe('verified');
    expect(verified.verifiedAt).not.toBeNull();
    expect(stored.rows).toEqual([{ provider: 'didit', status: 'approved' }]);
  });

  it('applies a decision once: the provider resending the same event changes nothing', async () => {
    const { member, attemptId } = await memberWithSession();
    const event = approval(attemptId, freshDocumentNumber(), `evt-repeat-${attemptId}`);

    const first = await deliver(event);
    const second = await deliver(event);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(second.json().webhook_event_id).toBe(first.json().webhook_event_id);
    expect((await verificationOf(member.userId).getStatus()).status).toBe('verified');
  });

  it('refuses an event that is not signed with the shared secret; the member stays unverified', async () => {
    const { member, attemptId } = await memberWithSession();

    const forged = await deliver(approval(attemptId, freshDocumentNumber(), `evt-forged-${attemptId}`), 'not-the-secret');

    expect(forged.statusCode).toBe(401);
    expect((await verificationOf(member.userId).getStatus()).status).toBe('in_progress');
  });

  it('opens no session without consent, and tells the member why', async () => {
    const member = await database.newMember();
    const before = sessionRequests.length;

    const refusal = await verificationOf(member.userId).startSession().then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(BackendRuleError);
    expect((refusal as BackendRuleError).reason).toBe('consent_required');
    // The database refused before the provider was called.
    expect(sessionRequests).toHaveLength(before);
  });
});
