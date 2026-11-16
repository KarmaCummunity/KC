// The CI gate of the extraction quality (FR-IMPORT-010 AC2): the golden set is replayed through
// the real pipeline with the recorded model and must meet every minimum.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import { prepareImportText } from '../domain/prepareImportText.ts';
import { scrubPii } from '../domain/scrubPii.ts';
import { GOLDEN_CASES } from './golden.ts';
import { formatReport, gateFailures } from './metrics.ts';
import { recordedFrom, recordedProvider, replay } from './replay.ts';
import { THRESHOLDS, type GoldenCase } from './types.ts';

Deno.test('the golden set is big enough, labelled, unique and free of contact details', () => {
  assert(GOLDEN_CASES.length >= 150, `only ${GOLDEN_CASES.length} cases`);
  assertEquals(new Set(GOLDEN_CASES.map((c) => c.id)).size, GOLDEN_CASES.length);
  assertEquals(new Set(GOLDEN_CASES.map((c) => c.text)).size, GOLDEN_CASES.length, 'duplicate message');
  for (const c of GOLDEN_CASES) {
    const removed = scrubPii(c.text).removed;
    assertEquals(removed, { phone: 0, email: 0, id: 0, url: 0 }, `${c.id} carries a contact detail`);
    prepareImportText(c.text); // every message has readable content
  }
});

Deno.test('the set covers every world, both directions, every kind of non-post and the time forms', () => {
  const posts = GOLDEN_CASES.filter((c) => c.expect.isPost);
  for (const world of ['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge']) {
    assert(posts.some((c) => c.expect.world === world), `no case for ${world}`);
  }
  assert(posts.some((c) => c.expect.direction === 'offer') && posts.some((c) => c.expect.direction === 'request'));
  for (const reject of ['not_a_post', 'commercial', 'forbidden']) {
    assert(GOLDEN_CASES.some((c) => c.expect.reject === reject), `no ${reject} case`);
  }
  for (const kind of ['relative_day', 'weekday', 'date', 'recurring']) {
    assert(GOLDEN_CASES.some((c) => c.when?.kind === kind), `no ${kind} time case`);
  }
  assert(GOLDEN_CASES.filter((c) => c.expect.reject === 'commercial').length >= 20, 'commercial recall needs 20 cases to tolerate one miss');
  assert(GOLDEN_CASES.some((c) => /[a-z]{4,}/i.test(c.text)), 'an English case');
  assert(GOLDEN_CASES.some((c) => c.sentAt), 'a message with its own timestamp');
});

Deno.test('GATE: the replayed golden set meets every minimum', async () => {
  const { report } = await replay([...GOLDEN_CASES]);
  console.log(`\n${formatReport(report)}`);
  assertEquals(gateFailures(report), [], 'a metric fell below its minimum; the table above names the misses');
  for (const metric of Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]) {
    assert(report.rates[metric] !== undefined, `${metric} has no labelled case`);
  }
});

Deno.test('the recorded model is not perfect, so the gate has something to measure', async () => {
  const { report } = await replay([...GOLDEN_CASES]);
  assert(report.misses.length >= 8, 'the deliberate model mistakes are missing');
  assert(report.misses.length <= 25, 'too many mistakes: the recording itself is broken');
});

Deno.test('the gate really fails: a model that gets the direction wrong everywhere is caught', async () => {
  const flipped = (c: GoldenCase) => {
    const raw = recordedFrom(c) as Record<string, unknown>;
    return raw.is_post ? { ...raw, direction: raw.direction === 'offer' ? 'request' : 'offer' } : raw;
  };
  const { report } = await replay([...GOLDEN_CASES], recordedProvider([...GOLDEN_CASES], flipped));
  assert(gateFailures(report).includes('direction'));
});

Deno.test('the gate really fails: a model that calls every ad a post is caught', async () => {
  const everythingIsAPost = (c: GoldenCase) => (c.expect.reject === 'commercial'
    ? { ...recordedFrom({ ...c, expect: { isPost: true, direction: 'offer', world: 'items', sub: 'other' } }) }
    : recordedFrom(c));
  const { report } = await replay([...GOLDEN_CASES], recordedProvider([...GOLDEN_CASES], everythingIsAPost));
  assert(gateFailures(report).includes('commercial_recall'));
});

Deno.test('the gate really fails: a model that times out is caught everywhere', async () => {
  const provider = { extract: () => Promise.reject(new Error('down')) };
  const { report } = await replay([...GOLDEN_CASES], provider);
  assert(gateFailures(report).length >= 5);
});
