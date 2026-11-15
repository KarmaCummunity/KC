import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createResearchHandler, mapRpcError, type SubmitArgs } from './handler.ts';

const ORIGIN = 'http://localhost:3000';
const BODY = { slug: 'alt-platforms', version: 2, answers: { q1: { rating: 4 } }, honeypot: '' };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/public-research-submit', {
    method: 'POST',
    headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'UA/1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function setup(over: { salt?: () => Promise<string>; submit?: (a: SubmitArgs) => Promise<string> } = {}) {
  const submitted: SubmitArgs[] = [];
  const reported: unknown[] = [];
  const handler = createResearchHandler({
    getSalt: over.salt ?? (() => Promise.resolve('salt-1')),
    submit: (args) => {
      submitted.push(args);
      return over.submit ? over.submit(args) : Promise.resolve('resp-1');
    },
    report: (e) => { reported.push(e); return Promise.resolve(); },
  });
  return { handler, submitted, reported };
}

Deno.test('answers the preflight for an allowed origin and refuses another', async () => {
  const { handler } = setup();
  const ok = await handler(new Request('http://x', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const denied = await handler(new Request('http://x', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assertEquals(denied.status, 403);
});

Deno.test('refuses a wrong method and a foreign origin before touching the database', async () => {
  const { handler, submitted } = setup();
  assertEquals((await handler(new Request('http://x', { method: 'GET' }))).status, 405);
  assertEquals((await handler(post(BODY, { origin: 'https://evil.example' }))).status, 403);
  assertEquals(submitted, []);
});

Deno.test('rejects a body that is not JSON or lacks a required field with 400 invalid_body', async () => {
  const { handler, submitted } = setup();
  for (const bad of ['not json', {}, { ...BODY, slug: '' }, { ...BODY, version: '2' }, { ...BODY, answers: [] }, { ...BODY, honeypot: null }]) {
    const res = await handler(post(bad));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'invalid_body' });
  }
  assertEquals(submitted, []);
});

Deno.test('hashes the first forwarded address and the user agent with the salt, never sending them raw', async () => {
  const { handler, submitted } = setup();
  const res = await handler(post({ ...BODY, source: 'newsletter', contactEmail: 'a@b.c', contactWindowHe: 'evening' }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { responseId: 'resp-1' });
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const sent = submitted[0];
  assertEquals(sent.p_ip_hash.length, 64);
  assertEquals(sent.p_user_agent_hash.length, 64);
  assertNotEquals(sent.p_ip_hash, sent.p_user_agent_hash);
  assertEquals(JSON.stringify(sent).includes('203.0.113.7'), false);
  assertEquals(
    { slug: sent.p_slug, version: sent.p_version, source: sent.p_source, email: sent.p_contact_email, window: sent.p_contact_window_he },
    { slug: 'alt-platforms', version: 2, source: 'newsletter', email: 'a@b.c', window: 'evening' },
  );
});

Deno.test('the same visitor hashes alike under one salt and differently under another', async () => {
  const hashes: string[] = [];
  for (const salt of ['salt-1', 'salt-1', 'salt-2']) {
    const { handler, submitted } = setup({ salt: () => Promise.resolve(salt) });
    await handler(post(BODY));
    hashes.push(submitted[0].p_ip_hash);
  }
  assertEquals(hashes[0], hashes[1]);
  assertNotEquals(hashes[0], hashes[2]);
});

Deno.test('defaults the source to direct and leaves absent contact fields null', async () => {
  const { handler, submitted } = setup();
  await handler(post(BODY));
  assertEquals([submitted[0].p_source, submitted[0].p_contact_email, submitted[0].p_contact_window_he], ['direct', null, null]);
});

Deno.test('maps the database errors to stable statuses', () => {
  assertEquals(mapRpcError('rate_limited_minute'), { status: 429, body: { error: 'rate_limited', period: 'minute' } });
  assertEquals(mapRpcError('rate_limited_hour'), { status: 429, body: { error: 'rate_limited', period: 'hour' } });
  assertEquals(mapRpcError('rate_limited_day'), { status: 429, body: { error: 'rate_limited', period: 'day' } });
  assertEquals(mapRpcError('research_circuit_open'), { status: 503, body: { error: 'circuit_open' } });
  assertEquals(mapRpcError('survey_not_found_or_version_mismatch'), { status: 400, body: { error: 'survey_not_found' } });
  assertEquals(mapRpcError('invalid_input'), { status: 400, body: { error: 'invalid_body' } });
  assertEquals(mapRpcError('anything else'), { status: 500, body: { error: 'internal' } });
});

Deno.test('a database error comes back mapped, with the CORS headers', async () => {
  const { handler } = setup({ submit: () => Promise.reject(new Error('rate_limited_hour')) });
  const res = await handler(post(BODY));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: 'rate_limited', period: 'hour' });
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

Deno.test('a missing salt is reported and answered 500 salt_missing without submitting', async () => {
  const { handler, submitted, reported } = setup({ salt: () => Promise.reject(new Error('down')) });
  const res = await handler(post(BODY));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'salt_missing' });
  assertEquals(submitted, []);
  assertEquals(reported.length, 1);
});
