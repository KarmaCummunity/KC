import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createObservability, readErrorCode } from './core.ts';
import type { SentryEvent } from './event.ts';

const DSN = 'https://pk@o1.ingest.sentry.io/99';
const REQ_URL = 'https://x/functions/v1/demo?apikey=secret';

type Sent = { url: string; headers: Record<string, string>; event: SentryEvent };

/** Fake transport + log sink; `status` controls the Sentry reply, `fail` makes fetch throw. */
function harness(opts: { dsn?: string | null; status?: number; fail?: boolean } = {}) {
  const sent: Sent[] = [];
  const logs: Record<string, unknown>[] = [];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    if (opts.fail) return Promise.reject(new Error('network down'));
    const lines = String(init?.body).split('\n');
    sent.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      event: JSON.parse(lines[2]) as SentryEvent,
    });
    return Promise.resolve(new Response(null, { status: opts.status ?? 200 }));
  }) as typeof fetch;
  const obs = createObservability({
    dsn: opts.dsn === undefined ? DSN : opts.dsn,
    environment: 'test',
    release: 'functions@sha',
    tags: { region: 'eu-west-1' },
    fetchFn,
    log: (l) => logs.push(l as Record<string, unknown>),
  });
  return { ...obs, sent, logs };
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const post = () => new Request(REQ_URL, { method: 'POST' });

Deno.test('a throw that escapes the handler → one unhandled exception event + generic JSON 500', async () => {
  const h = harness();
  const wrapped = h.withObservability('demo', () => {
    throw new TypeError('secret detail');
  });
  const res = await wrapped(post());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'internal' });

  assertEquals(h.sent.length, 1);
  const { url, headers, event } = h.sent[0];
  assertEquals(url, 'https://o1.ingest.sentry.io/api/99/envelope/');
  assertEquals(headers['Content-Type'], 'application/x-sentry-envelope');
  assertStringIncludes(headers['X-Sentry-Auth'], 'sentry_key=pk');
  assertEquals(event.environment, 'test');
  assertEquals(event.release, 'functions@sha');
  assertEquals(event.tags, { region: 'eu-west-1', edge_function: 'demo', handled: 'false' });
  assertEquals(event.platform, 'node');
  assertEquals(event.request, { method: 'POST', url: 'https://x/functions/v1/demo' });
  assertEquals(event.exception!.values[0].type, 'TypeError');
  assertEquals(event.exception!.values[0].mechanism.handled, false);

  // Timing line (withTiming) + error line (reporter), both structured.
  const errorLine = h.logs.find((l) => l.evt === 'edge_error')!;
  assertEquals(errorLine.sentry, 'sent');
  assertEquals(errorLine.error, 'TypeError: secret detail');
  const timing = h.logs.find((l) => 'invocation_ms' in l)!;
  assertEquals(timing.status, 500);
});

Deno.test('a 5xx response → one message event tagged with status + error code; body passes through untouched', async () => {
  const h = harness();
  const wrapped = h.withObservability('demo', () => Promise.resolve(json({ ok: false, error: 'db_failed', detail: 'x' }, 500)));
  const res = await wrapped(post());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, error: 'db_failed', detail: 'x' });
  assertEquals(h.sent.length, 1);
  const { event } = h.sent[0];
  assertEquals(event.message, { formatted: 'demo responded 500 (db_failed)' });
  assertEquals(event.tags.status, '500');
  assertEquals(event.tags.error_code, 'db_failed');
  assertEquals(event.tags.handled, 'true');
});

Deno.test('2xx and 4xx responses are never reported', async () => {
  const h = harness();
  const wrapped = h.withObservability('demo', (req) => Promise.resolve(json({ error: 'unauthorized' }, req.method === 'GET' ? 401 : 200)));
  await wrapped(post());
  await wrapped(new Request(REQ_URL, { method: 'GET' }));
  assertEquals(h.sent.length, 0);
  assertEquals(h.logs.filter((l) => l.evt === 'edge_error').length, 0);
});

Deno.test('free-text error bodies are not forwarded as tags (PII guard)', async () => {
  const h = harness();
  const wrapped = h.withObservability('demo', () => Promise.resolve(json({ ok: false, error: 'duplicate key value violates "users_email_key"' }, 500)));
  await wrapped(post());
  assertEquals(h.sent[0].event.message, { formatted: 'demo responded 500' });
  assertEquals(h.sent[0].event.tags.error_code, undefined);
});

Deno.test('reportError inside the handler → one handled exception event; the 5xx hook does not add a second', async () => {
  const h = harness();
  const wrapped = h.withObservability('demo', async (req) => {
    await h.reportError(new Error('storage listing failed'), { fn: 'demo', req, tags: { stage: 'storage' }, extra: { bucket: 'b' } });
    return json({ ok: false, error: 'internal' }, 500);
  });
  await wrapped(post());
  assertEquals(h.sent.length, 1);
  const { event } = h.sent[0];
  assertEquals(event.exception!.values[0].value, 'storage listing failed');
  assertEquals(event.exception!.values[0].mechanism.handled, true);
  assertEquals(event.tags.stage, 'storage');
  assertEquals(event.extra, { bucket: 'b' });
  assertEquals(event.request?.url, 'https://x/functions/v1/demo');
});

Deno.test('reportError without a request (background job) is sent and requests stay independent', async () => {
  const h = harness();
  await h.reportError('agent crashed', { fn: 'whatsapp-webhook', tags: { job: 'wa_agent' } });
  const wrapped = h.withObservability('whatsapp-webhook', () => Promise.resolve(json({ error: 'internal' }, 500)));
  await wrapped(post());
  assertEquals(h.sent.length, 2);
  assertEquals(h.sent[0].event.exception!.values[0], {
    type: 'NonError',
    value: 'agent crashed',
    mechanism: { type: 'kc.edge-observability', handled: true },
  });
  assertEquals(h.sent[0].event.request, undefined);
  assertEquals(h.sent[1].event.message?.formatted, 'whatsapp-webhook responded 500 (internal)');
});

Deno.test('no DSN → nothing is sent, the structured log line still records the error', async () => {
  const h = harness({ dsn: null });
  const wrapped = h.withObservability('demo', () => Promise.reject(new Error('boom')));
  const res = await wrapped(post());
  assertEquals(res.status, 500);
  assertEquals(h.sent.length, 0);
  const line = h.logs.find((l) => l.evt === 'edge_error')!;
  assertEquals(line.sentry, 'skipped_no_dsn');
  assertEquals(line.error, 'Error: boom');
  assertEquals(line.fn, 'demo');
});

Deno.test('Sentry failures never change the response: fetch throws or replies 429', async () => {
  for (const opts of [{ fail: true }, { status: 429 }]) {
    const h = harness(opts);
    const wrapped = h.withObservability('demo', () => Promise.reject(new Error('boom')));
    const res = await wrapped(post());
    assertEquals(res.status, 500);
    assertEquals(h.logs.find((l) => l.evt === 'edge_error')!.sentry, 'failed');
  }
});

Deno.test('readErrorCode: JSON code bodies only; text, huge and non-code bodies → null', async () => {
  assertEquals(await readErrorCode(json({ error: 'auth_delete_failed' }, 500)), 'auth_delete_failed');
  assertEquals(await readErrorCode(json({ error: 42 }, 500)), null);
  assertEquals(await readErrorCode(new Response('Internal Error', { status: 500 })), null);
  assertEquals(await readErrorCode(json({ error: 'x'.repeat(5000) }, 500)), null);
  const huge = json({ error: 'internal' }, 500);
  huge.headers.set('content-length', '999999');
  assertEquals(await readErrorCode(huge), null);
  // The inspected body remains readable by the caller (clone, not consume).
  const res = json({ error: 'internal' }, 500);
  await readErrorCode(res);
  assertEquals(await res.json(), { error: 'internal' });
});
