import { describe, expect, it } from 'vitest';
import { receiveRevenueCatEvent, type RevenueCatDeps } from '../revenueCatEvents';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const ORGANIZATION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** The handler with a recording database; `deliver` sends an event with the given Authorization header. */
function setup(overrides: Partial<RevenueCatDeps> = {}) {
  const calls: Array<{ holder: 'member' | 'organization'; id: string; active: boolean; expiresAt: string | null }> = [];
  const reported: unknown[] = [];
  const deps: RevenueCatDeps = {
    authSecret: 's3cret',
    proEntitlementId: 'pro',
    orgEntitlementId: 'org',
    now: () => 1000,
    setMemberPro: (id, active, expiresAt) => {
      calls.push({ holder: 'member', id, active, expiresAt });
      return Promise.resolve({ status: 'ok' });
    },
    setOrganizationPlan: (id, active, expiresAt) => {
      calls.push({ holder: 'organization', id, active, expiresAt });
      return Promise.resolve({ status: 'ok' });
    },
    report: (error) => reported.push(error),
    ...overrides,
  };
  const deliver = (event: unknown, authorization = 'Bearer s3cret', rawBody = JSON.stringify({ event })) =>
    receiveRevenueCatEvent({ headers: new Headers({ authorization }), rawBody }, deps);
  return { deliver, calls, reported };
}

describe('receiveRevenueCatEvent', () => {
  it('refuses a wrong secret, and every event when no secret is configured', async () => {
    const { deliver, calls } = setup();
    const unconfigured = setup({ authSecret: null });

    expect((await deliver({ type: 'INITIAL_PURCHASE', app_user_id: USER_ID }, 'nope')).status).toBe(401);
    expect(await unconfigured.deliver({ type: 'INITIAL_PURCHASE', app_user_id: USER_ID }, 'Bearer ')).toEqual({ status: 503, body: { error: 'not_configured' } });
    expect([...calls, ...unconfigured.calls]).toEqual([]);
  });

  it('accepts the secret with or without the Bearer prefix', async () => {
    const { deliver } = setup();

    expect((await deliver({ type: 'TEST' }, 's3cret')).body).toEqual({ status: 'test_ok' });
    expect((await deliver({ type: 'TEST' })).body).toEqual({ status: 'test_ok' });
  });

  it('grants Pro on a purchase that has not expired', async () => {
    const { deliver, calls } = setup();

    const answer = await deliver({ type: 'INITIAL_PURCHASE', app_user_id: USER_ID, entitlement_ids: ['pro'], expiration_at_ms: 5000 });

    expect(answer).toEqual({ status: 200, body: { status: 'ok' } });
    expect(calls).toEqual([{ holder: 'member', id: USER_ID, active: true, expiresAt: new Date(5000).toISOString() }]);
  });

  it('revokes on expiration, and on a purchase event that arrives already expired', async () => {
    const { deliver, calls } = setup();

    await deliver({ type: 'EXPIRATION', app_user_id: USER_ID, expiration_at_ms: 500 });
    await deliver({ type: 'RENEWAL', app_user_id: USER_ID, expiration_at_ms: 999 });

    expect(calls.map((call) => call.active)).toEqual([false, false]);
  });

  it('ignores another entitlement, an anonymous subscriber and an event type that changes nothing', async () => {
    const { deliver, calls } = setup();

    expect((await deliver({ type: 'RENEWAL', app_user_id: USER_ID, entitlement_ids: ['other'] })).body).toEqual({ status: 'ignored_entitlement' });
    expect((await deliver({ type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc' })).body).toEqual({ status: 'no_kc_user' });
    expect((await deliver({ type: 'BILLING_ISSUE', app_user_id: USER_ID })).body).toEqual({ status: 'ignored_type' });
    expect(calls).toEqual([]);
  });

  it('sends an organization purchase to the organization, not the member, and its expiration revokes the plan', async () => {
    const { deliver, calls } = setup();

    await deliver({ type: 'INITIAL_PURCHASE', app_user_id: `org:${ORGANIZATION_ID}`, entitlement_ids: ['org'], expiration_at_ms: 5000 });
    await deliver({ type: 'EXPIRATION', app_user_id: `org:${ORGANIZATION_ID}`, entitlement_ids: ['org'], expiration_at_ms: 500 });

    expect(calls).toEqual([
      { holder: 'organization', id: ORGANIZATION_ID, active: true, expiresAt: new Date(5000).toISOString() },
      { holder: 'organization', id: ORGANIZATION_ID, active: false, expiresAt: new Date(500).toISOString() },
    ]);
  });

  it('lets the entitlement pick the holder when a subscriber is known under both ids', async () => {
    const { deliver, calls } = setup();
    const ids = { app_user_id: USER_ID, aliases: [`org:${ORGANIZATION_ID}`] };

    await deliver({ type: 'RENEWAL', ...ids, entitlement_ids: ['pro'], expiration_at_ms: 5000 });
    await deliver({ type: 'RENEWAL', ...ids, entitlement_ids: ['org'], expiration_at_ms: 5000 });

    expect(calls.map((call) => call.holder)).toEqual(['member', 'organization']);
  });

  it('ignores an organization id with the Pro entitlement, a malformed organization id and a member with the organization entitlement', async () => {
    const { deliver, calls } = setup();

    await deliver({ type: 'RENEWAL', app_user_id: `org:${ORGANIZATION_ID}`, entitlement_ids: ['pro'] });
    await deliver({ type: 'RENEWAL', app_user_id: 'org:not-a-uuid', entitlement_ids: ['org'] });
    await deliver({ type: 'RENEWAL', app_user_id: USER_ID, entitlement_ids: ['org'] });

    expect(calls).toEqual([]);
  });

  it('answers 400 for a body that is not JSON, and 500 for a database failure so the event is sent again', async () => {
    const failure = new Error('connection reset');
    const { deliver } = setup();
    const failing = setup({ setMemberPro: () => Promise.reject(failure) });

    expect(await deliver(null, 'Bearer s3cret', 'not json')).toEqual({ status: 400, body: { error: 'bad_json' } });
    expect(await failing.deliver({ type: 'RENEWAL', app_user_id: USER_ID })).toEqual({ status: 500, body: { error: 'rpc_failed' } });
    expect(failing.reported).toEqual([failure]);
  });
});
