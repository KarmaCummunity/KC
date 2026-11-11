import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createRevenueCatHandler } from './handler.ts';

const U = '11111111-2222-3333-4444-555555555555';
function setup() {
  const calls: Record<string, unknown>[] = [];
  const h = createRevenueCatHandler({
    authSecret: 's3cret', entitlementId: 'pro', orgEntitlementId: 'org', now: () => 1000,
    rpc: (fn, a) => { calls.push({ fn, ...a }); return Promise.resolve({ data: { status: 'ok' }, error: null }); },
  });
  const post = (ev: unknown, auth = 'Bearer s3cret') =>
    h(new Request('http://x', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify({ event: ev }) }));
  return { calls, post };
}

Deno.test('rejects bad auth', async () => {
  const { post, calls } = setup();
  assertEquals((await post({ type: 'INITIAL_PURCHASE', app_user_id: U }, 'nope')).status, 401);
  assertEquals(calls.length, 0);
});
Deno.test('grants on purchase', async () => {
  const { post, calls } = setup();
  assertEquals((await post({ type: 'INITIAL_PURCHASE', app_user_id: U, entitlement_ids: ['pro'], expiration_at_ms: 5000 })).status, 200);
  assertEquals(calls[0].p_active, true);
});
Deno.test('revokes on expiration', async () => {
  const { post, calls } = setup();
  await post({ type: 'EXPIRATION', app_user_id: U, expiration_at_ms: 500 });
  assertEquals(calls[0].p_active, false);
});
Deno.test('ignores other entitlement and anonymous ids', async () => {
  const { post, calls } = setup();
  await post({ type: 'RENEWAL', app_user_id: U, entitlement_ids: ['other'] });
  await post({ type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc' });
  assertEquals(calls.length, 0);
});

const O = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
Deno.test('an organization purchase goes to the organization, not the member', async () => {
  const { post, calls } = setup();
  assertEquals((await post({ type: 'INITIAL_PURCHASE', app_user_id: `org:${O}`, entitlement_ids: ['org'], expiration_at_ms: 5000 })).status, 200);
  assertEquals(calls, [{ fn: 'api_revenuecat_set_org_entitlement', p_org_id: O, p_active: true, p_expires_at: new Date(5000).toISOString() }]);
});
Deno.test('an organization expiration revokes the organization plan', async () => {
  const { post, calls } = setup();
  await post({ type: 'EXPIRATION', app_user_id: `org:${O}`, entitlement_ids: ['org'], expiration_at_ms: 500 });
  assertEquals([calls[0].fn, calls[0].p_active], ['api_revenuecat_set_org_entitlement', false]);
});
Deno.test('the entitlement picks the holder when a subscriber is known under both ids', async () => {
  const { post, calls } = setup();
  const ids = { app_user_id: U, aliases: [`org:${O}`] };
  await post({ type: 'RENEWAL', ...ids, entitlement_ids: ['pro'], expiration_at_ms: 5000 });
  await post({ type: 'RENEWAL', ...ids, entitlement_ids: ['org'], expiration_at_ms: 5000 });
  assertEquals(calls.map((c) => c.fn), ['api_revenuecat_set_pro', 'api_revenuecat_set_org_entitlement']);
});
Deno.test('an organization id with the Pro entitlement, a malformed organization id and an unknown entitlement are ignored', async () => {
  const { post, calls } = setup();
  await post({ type: 'RENEWAL', app_user_id: `org:${O}`, entitlement_ids: ['pro'] });
  await post({ type: 'RENEWAL', app_user_id: 'org:not-a-uuid', entitlement_ids: ['org'] });
  await post({ type: 'RENEWAL', app_user_id: U, entitlement_ids: ['org'] });
  assertEquals(calls.length, 0);
});
