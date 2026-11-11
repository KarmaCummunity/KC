import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createChargerHandler, type DueCharge } from './handler.ts';

const KEY = 'service-key';
const req = (token: string | undefined = KEY, body?: unknown, method = 'POST') =>
  new Request('http://x/subscriptions-charger', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CHARGE: DueCharge = { intent_id: 'i1', standing_order_id: 's1', amount_agorot: 5000, mandate_ref: 'm1' };

function setup(over: { charges?: DueCharge[]; openError?: boolean; submit?: (c: DueCharge) => Promise<void> } = {}) {
  const limits: number[] = [];
  const reported: { stage: string; intent_id?: string }[] = [];
  const handler = createChargerHandler({
    serviceRoleKey: KEY,
    openDueCharges: (limit) => {
      limits.push(limit);
      return over.openError ? Promise.reject(new Error('db down')) : Promise.resolve(over.charges ?? []);
    },
    submit: over.submit,
    report: (_e, tags) => { reported.push(tags); return Promise.resolve(); },
  });
  return { handler, limits, reported };
}

Deno.test('rejects a wrong method and any caller but the service role before opening a charge', async () => {
  const { handler, limits } = setup();
  assertEquals((await handler(req(KEY, undefined, 'GET'))).status, 405);
  assertEquals((await handler(req(''))).status, 401);
  assertEquals((await handler(req('another-key'))).status, 401);
  assertEquals(limits, []);
});

Deno.test('opens at most the requested number of charges, 20 by default, 50 at most', async () => {
  for (const [body, expected] of [[{ limit: 5 }, 5], [{ limit: 500 }, 50], [{}, 20], [undefined, 20]] as const) {
    const { handler, limits } = setup();
    assertEquals(await (await handler(req(KEY, body))).json(), { ok: true, opened: 0, submitted: 0, failed: 0 });
    assertEquals(limits, [expected]);
  }
});

Deno.test('without a provider adapter the opened charges are counted and left for the provider events', async () => {
  const { handler } = setup({ charges: [CHARGE, { ...CHARGE, intent_id: 'i2' }] });
  assertEquals(await (await handler(req())).json(), { ok: true, opened: 2, submitted: 0, failed: 0 });
});

Deno.test('submits every opened charge; one failure is reported and does not stop the others', async () => {
  const seen: string[] = [];
  const { handler, reported } = setup({
    charges: [CHARGE, { ...CHARGE, intent_id: 'i2' }, { ...CHARGE, intent_id: 'i3' }],
    submit: (c) => {
      seen.push(c.intent_id);
      return c.intent_id === 'i2' ? Promise.reject(new Error('provider down')) : Promise.resolve();
    },
  });
  assertEquals(await (await handler(req())).json(), { ok: true, opened: 3, submitted: 2, failed: 1 });
  assertEquals(seen, ['i1', 'i2', 'i3']);
  assertEquals(reported, [{ stage: 'submit', intent_id: 'i2' }]);
});

Deno.test('a failure to open the charges is reported and answered 500 without the cause', async () => {
  const { handler, reported } = setup({ openError: true });
  const res = await handler(req());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'internal' });
  assertEquals(reported, [{ stage: 'open' }]);
});
