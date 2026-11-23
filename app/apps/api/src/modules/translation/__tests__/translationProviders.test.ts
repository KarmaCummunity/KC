import { describe, expect, it } from 'vitest';
import { GeminiClient } from '../../../platform/ai/geminiClient';
import { GeminiProvider } from '../geminiProvider';
import { GoogleFreeProvider } from '../googleFreeProvider';
import { type ProviderInput, type ProviderResult, type TranslationProvider, translateMany } from '../translationProvider';

/** One recorded outbound request. */
interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A `fetch` that answers from a queue and records what it was asked. */
function fakeFetch(answers: Array<{ status: number; body: string }>) {
  const calls: Call[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected request');
    return Promise.resolve(new Response(answer.body, { status: answer.status }));
  };
  return { fetch: fetchFake, calls };
}

const noSleep = () => Promise.resolve();
const googleAnswer = (segments: string[], detected: string) => JSON.stringify([segments.map((segment) => [segment, 'source']), null, detected]);

describe('GoogleFreeProvider', () => {
  it('sends the text in the body, asks for Hebrew by its legacy tag, and joins the segments', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: googleAnswer(['ספה ', 'כחולה'], 'en') }]);

    const result = await new GoogleFreeProvider({ fetch }).translate({ text: 'Blue sofa', targetLanguage: 'he-IL' });

    expect(result).toEqual({ translatedText: 'ספה כחולה', detectedSourceLanguage: 'en', confidence: null, model: 'google-translate-web' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('tl=iw');
    expect(calls[0]?.url).not.toContain('Blue');
    expect(calls[0]?.init?.body).toBe('q=Blue+sofa');
  });

  it('reports a Hebrew source as `he`, not the endpoint\'s legacy `iw`', async () => {
    const { fetch } = fakeFetch([{ status: 200, body: googleAnswer(['Blue sofa'], 'iw') }]);

    const result = await new GoogleFreeProvider({ fetch }).translate({ text: 'ספה כחולה', targetLanguage: 'en' });

    expect(result.detectedSourceLanguage).toBe('he');
  });

  it('retries a rate-limited call with a growing wait, then succeeds', async () => {
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch([
      { status: 429, body: 'slow down' },
      { status: 503, body: 'busy' },
      { status: 200, body: googleAnswer(['Sofa'], 'he') },
    ]);
    const provider = new GoogleFreeProvider({ fetch, sleep: (ms) => (waits.push(ms), Promise.resolve()) });

    const result = await provider.translate({ text: 'ספה', targetLanguage: 'en' });

    expect(result.translatedText).toBe('Sofa');
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([700, 1400]);
  });

  it('falls back to the second keyless service when the first keeps failing, and says why', async () => {
    const reasons: string[] = [];
    const { fetch, calls } = fakeFetch([
      ...Array.from({ length: 4 }, () => ({ status: 429, body: 'slow down' })),
      { status: 200, body: JSON.stringify({ responseData: { translatedText: ' Sofa ' }, responseStatus: 200 }) },
    ]);
    const provider = new GoogleFreeProvider({ fetch, sleep: noSleep, onFallback: (detail) => reasons.push(detail) });

    const result = await provider.translate({ text: 'ספה', targetLanguage: 'en' });

    expect(result).toEqual({ translatedText: 'Sofa', detectedSourceLanguage: null, confidence: null, model: 'mymemory-free' });
    expect(calls).toHaveLength(5);
    expect(calls[4]?.url).toContain('langpair=Autodetect%7Cen');
    expect(reasons).toEqual(['google-free http 429: slow down']);
  });

  it('does not retry a refusal that is not transient, and rejects when the fallback fails too', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 400, body: 'bad request' },
      { status: 200, body: JSON.stringify({ responseData: { translatedText: '' }, responseStatus: 403 }) },
    ]);

    await expect(new GoogleFreeProvider({ fetch, sleep: noSleep }).translate({ text: 'ספה', targetLanguage: 'en' })).rejects.toThrow('mymemory status 403');
    expect(calls).toHaveLength(2);
  });
});

describe('GeminiProvider', () => {
  const modelAnswer = (answer: unknown) => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  const providerOver = (fetch: typeof globalThis.fetch) => new GeminiProvider(new GeminiClient({ apiKey: 'test-key', model: 'gemini-test', fetch }));

  it('sends the text as data after the rules, and clamps the confidence', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: modelAnswer({ translatedText: 'Sofa', detectedSourceLanguage: 'he', confidence: 1.7 }) }]);

    const result = await providerOver(fetch).translate({ text: 'ספה', targetLanguage: 'en', sourceHint: 'he' });

    expect(result).toEqual({ translatedText: 'Sofa', detectedSourceLanguage: 'he', confidence: 1, model: 'gemini-test' });
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] };
    // The member's text travels in the user turn; the system turn tells the model to treat it as untrusted.
    expect(sent.systemInstruction.parts[0]?.text).toContain('UNTRUSTED DATA');
    expect(sent.contents[0]?.parts[0]?.text).toBe('Target language: en (likely source: he)\nText:\nספה');
  });

  it('rejects an answer with no translation', async () => {
    const { fetch } = fakeFetch([{ status: 200, body: modelAnswer({ translatedText: '' }) }]);

    await expect(providerOver(fetch).translate({ text: 'ספה', targetLanguage: 'en' })).rejects.toThrow('provider returned no translatedText');
  });
});

describe('translateMany', () => {
  /** Upper-cases after a tick, fails on "BOOM", and records how many calls were in flight at once. */
  class CountingProvider implements TranslationProvider {
    active = 0;
    peak = 0;
    translate(input: ProviderInput): Promise<ProviderResult> {
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          this.active -= 1;
          if (input.text === 'BOOM') reject(new Error('x'));
          else resolve({ translatedText: input.text.toUpperCase(), detectedSourceLanguage: 'he', confidence: null, model: 'fake' });
        }, 5),
      );
    }
  }
  const inputs = (texts: string[]) => texts.map((text) => ({ text, targetLanguage: 'en' }));

  it('keeps the order of the inputs and never exceeds the concurrency', async () => {
    const provider = new CountingProvider();

    const results = await translateMany(provider, inputs(['a', 'b', 'c', 'd', 'e']), 2);

    expect(results.map((result) => result?.translatedText)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(provider.peak).toBe(2);
  });

  it('answers null for a failing item, reports it, and still translates the rest', async () => {
    const failures: number[] = [];

    const results = await translateMany(new CountingProvider(), inputs(['ok', 'BOOM', 'fine']), 2, (index) => failures.push(index));

    expect(results.map((result) => result?.translatedText ?? null)).toEqual(['OK', null, 'FINE']);
    expect(failures).toEqual([1]);
  });

  it('makes no call for an empty batch', async () => {
    const provider = new CountingProvider();

    expect(await translateMany(provider, [], 2)).toEqual([]);
    expect(provider.peak).toBe(0);
  });
});
