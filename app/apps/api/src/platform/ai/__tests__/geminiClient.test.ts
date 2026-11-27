import { describe, expect, it } from 'vitest';
import { GeminiClient, GeminiError } from '../geminiClient';

/** A `fetch` that answers from a queue (a status and body, or a thrown error) and records the requests. */
function fakeFetch(answers: Array<{ status: number; body: string } | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFake: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected request');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(new Response(answer.body, { status: answer.status }));
  };
  return { fetch: fetchFake, calls };
}

const envelope = (answer: unknown) => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
const REQUEST = { systemInstruction: 'Rules.', userText: 'Data.', responseSchema: { type: 'OBJECT' } };
const noSleep = () => Promise.resolve();
const failureOf = (attempt: Promise<unknown>) => attempt.then(() => null, (error: unknown) => (error instanceof GeminiError ? [error.kind, error.status] : error));

describe('GeminiClient', () => {
  it('sends the key in a header, never in the URL, and asks for a deterministic JSON answer', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: envelope({ ok: true }) }]);

    const answer = await new GeminiClient({ apiKey: 'test-key', model: 'gemini-test', fetch }).generateJson(REQUEST);

    expect(answer).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(new Headers(calls[0]?.init?.headers).get('x-goog-api-key')).toBe('test-key');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      systemInstruction: { parts: [{ text: 'Rules.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Data.' }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } },
    });
  });

  it('fails as not configured without a key, before any request', async () => {
    const { fetch, calls } = fakeFetch([]);

    expect(await failureOf(new GeminiClient({ apiKey: null, model: 'm', fetch }).generateJson(REQUEST))).toEqual(['not_configured', undefined]);
    expect(calls).toEqual([]);
  });

  it('retries one transient refusal after a wait, and gives up on the second', async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => (waits.push(ms), Promise.resolve());
    const once = fakeFetch([{ status: 503, body: 'busy' }, { status: 200, body: envelope({ ok: 1 }) }]);
    const twice = fakeFetch([{ status: 429, body: 'quota' }, { status: 429, body: 'quota' }]);

    expect(await new GeminiClient({ apiKey: 'k', model: 'm', fetch: once.fetch, sleep, retryDelayMs: 400 }).generateJson(REQUEST)).toEqual({ ok: 1 });
    expect(await failureOf(new GeminiClient({ apiKey: 'k', model: 'm', fetch: twice.fetch, sleep: noSleep }).generateJson(REQUEST))).toEqual(['http', 429]);
    expect(waits).toEqual([400]);
    expect(twice.calls).toHaveLength(2);
  });

  it('does not retry a refusal that is not transient', async () => {
    const { fetch, calls } = fakeFetch([{ status: 400, body: 'bad request' }]);

    expect(await failureOf(new GeminiClient({ apiKey: 'k', model: 'm', fetch, sleep: noSleep }).generateJson(REQUEST))).toEqual(['http', 400]);
    expect(calls).toHaveLength(1);
  });

  it('tells a timeout from an unreachable provider', async () => {
    const slow = fakeFetch([new DOMException('too slow', 'TimeoutError')]);
    const down = fakeFetch([new TypeError('fetch failed')]);

    expect(await failureOf(new GeminiClient({ apiKey: 'k', model: 'm', fetch: slow.fetch }).generateJson(REQUEST))).toEqual(['timeout', undefined]);
    expect(await failureOf(new GeminiClient({ apiKey: 'k', model: 'm', fetch: down.fetch }).generateJson(REQUEST))).toEqual(['unreachable', undefined]);
  });

  it.each([
    ['an empty envelope', '{}'],
    ['a text part that is not JSON', JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })],
    ['a body that is not JSON', '<html>'],
  ])('answers bad_response for %s', async (_label, body) => {
    const { fetch } = fakeFetch([{ status: 200, body }]);

    expect(await failureOf(new GeminiClient({ apiKey: 'k', model: 'm', fetch }).generateJson(REQUEST))).toEqual(['bad_response', undefined]);
  });
});
