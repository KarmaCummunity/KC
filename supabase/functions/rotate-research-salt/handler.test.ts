import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createRotateSaltHandler } from './handler.ts';

const KEY = 'service-key';
const req = (token?: string, method = 'POST') =>
  new Request('http://x/rotate-research-salt', { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

function setup(rotate: () => Promise<string>) {
  const reported: unknown[] = [];
  const handler = createRotateSaltHandler({ serviceRoleKey: KEY, rotate, report: (e) => { reported.push(e); return Promise.resolve(); } });
  return { handler, reported };
}

Deno.test('rejects a wrong method and any caller but the service role before rotating', async () => {
  let rotations = 0;
  const { handler } = setup(() => { rotations++; return Promise.resolve('t'); });
  assertEquals((await handler(req(KEY, 'GET'))).status, 405);
  assertEquals((await handler(req())).status, 401);
  assertEquals((await handler(req('another-key'))).status, 401);
  assertEquals(rotations, 0);
});

Deno.test('rotates once and answers the rotation time', async () => {
  let rotations = 0;
  const { handler } = setup(() => { rotations++; return Promise.resolve('2026-11-11T00:15:00Z'); });
  const res = await handler(req(KEY));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, rotated_at: '2026-11-11T00:15:00Z' });
  assertEquals(rotations, 1);
});

Deno.test('a failed rotation is reported and answered 500 without the cause', async () => {
  const { handler, reported } = setup(() => Promise.reject(new Error('db down')));
  const res = await handler(req(KEY));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'internal' });
  assertEquals(reported.length, 1);
});
