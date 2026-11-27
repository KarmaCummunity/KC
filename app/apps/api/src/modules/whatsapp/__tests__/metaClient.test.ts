import { expect, it } from 'vitest';
import { buildPayload, classifyFailure, type FetchFn, sendMessage } from '../metaClient';

const cfg = { token: 'test-token-not-real', phoneNumberId: '1234567890', graphVersion: 'v21.0' };

function mockFetch(status: number, body: unknown, calls: { url: string; init?: RequestInit }[] = []): FetchFn {
  return (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

it('sendMessage posts a session text to the Graph messages endpoint', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const res = await sendMessage(cfg, { kind: 'session', to: '972500000001', body: 'hi' },
    mockFetch(200, { messages: [{ id: 'wamid.X' }] }, calls));
  expect(res).toEqual({ ok: true, waMessageId: 'wamid.X' });
  expect(calls[0]!.url).toEqual('https://graph.facebook.com/v21.0/1234567890/messages');
  expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toEqual('Bearer test-token-not-real');
  const sent = JSON.parse(String(calls[0]!.init?.body));
  expect(sent.type).toEqual('text');
  expect(sent.text.body).toEqual('hi');
});

it('buildPayload renders template name, language and ordered params', () => {
  const p = buildPayload({ kind: 'template', to: '9725', templateName: 'match_found_v1', language: 'en', params: ['Items', 'Open app'] });
  expect(p.type).toEqual('template');
  expect(p.template).toEqual({
    name: 'match_found_v1',
    language: { code: 'en' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Items' }, { type: 'text', text: 'Open app' }] }],
  });
});

it('429 / 5xx / throttling codes are retryable, outside-window is not', async () => {
  const r429 = await sendMessage(cfg, { kind: 'session', to: '1', body: 'x' },
    mockFetch(429, { error: { code: 130429, message: 'Rate limit hit' } }));
  expect(r429.ok).toEqual(false);
  if (!r429.ok) expect(r429.retryable).toEqual(true);

  const r400 = await sendMessage(cfg, { kind: 'session', to: '1', body: 'x' },
    mockFetch(400, { error: { code: 131047, message: 'Re-engagement message' } }));
  expect(r400.ok).toEqual(false);
  if (!r400.ok) {
    expect(r400.retryable).toEqual(false);
    expect(r400.error.includes('131047')).toEqual(true);
    expect(r400.error.includes('test-token-not-real')).toEqual(false);
  }

  expect(classifyFailure(503, null)).toEqual(true);
  expect(classifyFailure(400, 131026)).toEqual(false);
  expect(classifyFailure(400, 131056)).toEqual(true);
});

it('network errors are retryable', async () => {
  const res = await sendMessage(cfg, { kind: 'session', to: '1', body: 'x' },
    () => Promise.reject(new TypeError('connection reset')));
  expect(res).toEqual({ ok: false, error: 'network: connection reset', retryable: true });
});
