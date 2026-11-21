import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createDispatchHandler } from './handler.ts';

Deno.test('refused dispatch callers receive the shared JSON response without touching IO', async () => {
  const unreachable = new Proxy({}, { get() { throw new Error('refused caller reached IO'); } });
  const handler = createDispatchHandler({ db: unreachable as never, transport: unreachable as never, serviceRoleKey: 'test-service-key' });
  for (const authorization of [undefined, 'Bearer wrong-key', 'Basic test-service-key']) {
    const response = await handler(new Request('https://example.invalid', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }));
    assertEquals(response.status, 401);
    assertEquals(response.headers.get('Content-Type'), 'application/json');
    assertEquals(await response.json(), { ok: false, error: 'unauthenticated' });
  }
});

Deno.test('an unscoped call stays closed and never touches the queues', async () => {
  const unreachable = new Proxy({}, { get() { throw new Error('closed call reached IO'); } });
  const handler = createDispatchHandler({ db: unreachable as never, transport: unreachable as never, serviceRoleKey: 'test-service-key' });
  for (const body of [undefined, {}, { scope: {} }, { scope: { event_ids: [] } }, 'not json']) {
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-key', 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    }));
    assertEquals(response.status, 200);
    assertEquals((await response.json()).closed, true);
  }
});

Deno.test('a scoped call runs with exactly that scope on every queue claim', async () => {
  const seen: { method: string; limit: number; scope: unknown }[] = [];
  const db = {
    deliverBatch: (limit: number, scope?: unknown) => { seen.push({ method: 'deliver', limit, scope }); return Promise.resolve([]); },
    retryBatch: (limit: number, scope?: unknown) => { seen.push({ method: 'retry', limit, scope }); return Promise.resolve([]); },
    claimReceipts: (limit: number, scope?: unknown) => { seen.push({ method: 'receipts', limit, scope }); return Promise.resolve([]); },
    messagePreviews: () => Promise.resolve(new Map()),
    settle: () => Promise.resolve(),
  };
  const transport = { send: () => Promise.resolve([]) };
  const handler = createDispatchHandler({ db: db as never, transport: transport as never, serviceRoleKey: 'test-service-key', maxRounds: 3 });
  const scope = { event_ids: [20593], notification_id: 'af9de2bd-5853-4423-9d33-98a7ab6e4577', device_id: '11111111-2222-3333-4444-555555555555' };
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-service-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  }));
  assertEquals(response.status, 200);
  const summary = await response.json();
  assertEquals(summary.closed, undefined);
  assertEquals(seen.length > 0, true);
  for (const call of seen) {
    assertEquals(call.scope, { eventIds: [20593], notificationId: scope.notification_id, deviceId: scope.device_id });
  }
});
