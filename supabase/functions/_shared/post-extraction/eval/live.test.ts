import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { parseArgs, runLive } from './live.ts';
import { recordedFrom } from './replay.ts';
import { GOLDEN_CASES } from './golden.ts';
import type { PostExtractionProvider } from '../providerTypes.ts';

const noSleep = () => Promise.resolve();

/** A "live" provider that is in fact the recorded answers, found by the marker in the text. */
const stand: PostExtractionProvider = {
  extract: (input) => {
    const id = /\[#(g\d+)\]/.exec(input.text)![1];
    return Promise.resolve({ raw: recordedFrom(GOLDEN_CASES.find((c) => c.id === id)!), model: 'stand-in' });
  },
};

Deno.test('a live run reports, keeps the raw answers by case id and spaces the calls', async () => {
  const pauses: number[] = [];
  const result = await runLive(stand, { limit: 12, delayMs: 700 }, (ms) => { pauses.push(ms); return Promise.resolve(); });
  assertEquals(result.report.cases, 12);
  assertEquals(Object.keys(result.answers).length, 12);
  assertEquals(pauses.length, 12);
  assert(pauses.every((p) => p === 700));
});

Deno.test('a live run with a failing metric lists it', async () => {
  const broken: PostExtractionProvider = { extract: () => Promise.reject(new Error('down')) };
  const result = await runLive(broken, { limit: 20, delayMs: 0 }, noSleep);
  assert(result.failing.length > 0);
});

Deno.test('arguments: limit and record, nothing else', () => {
  assertEquals(parseArgs([]), { limit: null, record: null });
  assertEquals(parseArgs(['--limit', '5', '--record', 'a.json']), { limit: 5, record: 'a.json' });
  assertThrows(() => parseArgs(['--lmit', '5']), Error, 'unknown argument');
  assertThrows(() => parseArgs(['--limit', 'x']), Error, 'positive');
});
