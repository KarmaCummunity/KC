import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createRevenueCatHandler } from './handler.ts';

const U = '11111111-2222-3333-4444-555555555555';
function setup() {
  const calls: Record<string, unknown>[] = [];
  const h = createRevenueCatHandler({
    authSecret: 's3cret', entitlementId: 'pro', now: () => 1000,
    rpc: (_fn, a) => { calls.push(a); return Promise.resolve({ data: { status: 'ok' }, error: null }); },
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
