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
