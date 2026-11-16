import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { ExtractionOutcome } from '../extractPost.ts';
import type { ExtractedPost } from '../domain/importTypes.ts';
import { buildReport, calibrate, formatReport, gateFailures, isPostF1, localIso, placeKey, scoreCase } from './metrics.ts';
import { THRESHOLDS, type GoldenCase } from './types.ts';

const noTime = { kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null, timeHhmm: null, timePeriod: null, recurringWeekdays: [] } as const;

function extraction(over: Partial<ExtractedPost> = {}): ExtractedPost {
  return {
    isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'items', subcategory: 'furniture', title: 't', description: 'd',
    place: { cityText: 'בתל אביב', streetText: null, neighborhoodText: null }, time: noTime, ride: null, details: {}, language: 'he',
    confidence: { overall: 0.9, perField: {} }, ...over,
  };
}

function outcome(over: Partial<ExtractionOutcome> = {}): ExtractionOutcome {
  return {
    routing: 'confirm', reason: 'ok', extraction: extraction(), city: null, street: null, ride: null, time: null, confirmFields: [],
    confidence: 0.9, removed: null, truncated: false, fingerprint: null, model: 'm', providerCalled: true, cacheHit: false,
    promptVersion: 'v1', ...over,
  };
}

const post = (over: Partial<GoldenCase['expect']> = {}): GoldenCase => ({
  id: 'c1', text: 't', expect: { isPost: true, direction: 'offer', world: 'items', sub: 'furniture', city: 'תל אביב', ...over },
});

Deno.test('placeKey ignores prefix letters, quotes, dashes and niqqud', () => {
  assertEquals(placeKey('בתל אביב'), placeKey('תל אביב'));
  assertEquals(placeKey('ת"א'), placeKey('תא'));
  assertEquals(placeKey('תל אביב - יפו'), placeKey('תל אביב יפו'));
  assert(placeKey('חיפה') !== placeKey('חולון'));
  assertEquals(placeKey(null), '');
});

Deno.test('a fully right post scores right on every labelled field', () => {
  const s = scoreCase(post(), outcome());
  assertEquals(s.misses, []);
  assertEquals(s.tallies, { direction: true, world: true, subcategory: true, city: true });
});

Deno.test('each wrong field is a miss that names what was expected and what came back', () => {
  const s = scoreCase(post(), outcome({ extraction: extraction({ direction: 'request', worldSlug: 'food', subcategory: 'cooked', place: { cityText: 'חיפה', streetText: null, neighborhoodText: null } }) }));
  assertEquals(s.misses.map((m) => m.metric).sort(), ['city', 'direction', 'subcategory', 'world']);
  assertEquals(s.misses.find((m) => m.metric === 'direction')?.got, 'request');
});

Deno.test('a sub-category is right only inside the right world', () => {
  const s = scoreCase(post(), outcome({ extraction: extraction({ worldSlug: 'food', subcategory: 'furniture' }) }));
  assertEquals(s.tallies.subcategory, false);
});

Deno.test('a failed extraction misses every labelled field instead of vanishing', () => {
  const s = scoreCase(post(), outcome({ reason: 'provider_failed', extraction: null, routing: 'manual' }));
  assertEquals(s.misses.length, 4);
});

Deno.test('commercial recall: the ad must not come back as a post', () => {
  const ad: GoldenCase = { id: 'a', text: 't', expect: { isPost: false, reject: 'commercial' } };
  assertEquals(scoreCase(ad, outcome({ reason: 'rejected', extraction: null })).tallies, { commercial_recall: true });
  assertEquals(scoreCase(ad, outcome()).tallies, { commercial_recall: false });
});

Deno.test('a non-post that is not commercial is scored by F1 only', () => {
  const chat: GoldenCase = { id: 'n', text: 't', expect: { isPost: false, reject: 'not_a_post' } };
  assertEquals(scoreCase(chat, outcome({ reason: 'not_a_post' })).tallies, {});
});

Deno.test('a ride is right only when both ends are', () => {
  const ride: GoldenCase = { id: 'r', text: 't', expect: { isPost: true, direction: 'offer', world: 'rides', origin: 'חיפה', destination: 'תל אביב' } };
  const x = (origin: string, destination: string) => outcome({
    extraction: extraction({ worldSlug: 'rides', ride: { originText: origin, destinationText: destination, meetingTexts: [], seats: null } }),
  });
  assertEquals(scoreCase(ride, x('מחיפה', 'לתל אביב')).tallies.ride_route, true);
  assertEquals(scoreCase(ride, x('חיפה', 'ירושלים')).tallies.ride_route, false);
});

Deno.test('departure: a time label needs the instant, a date label needs the day', () => {
  const at = new Date('2026-11-05T06:00:00Z');
  const t = (over: object) => outcome({ time: { at, dateIso: '2026-11-05', recurringWeekdays: [], ambiguousHour: false, dropped: null, ...over } });
  assertEquals(localIso(at), '2026-11-05T08:00');
  assertEquals(scoreCase(post({ at: '2026-11-05T08:00' }), t({})).tallies.departure, true);
  assertEquals(scoreCase(post({ at: '2026-11-05T09:00' }), t({})).tallies.departure, false);
  assertEquals(scoreCase(post({ at: '2026-11-05' }), t({ at: null })).tallies.departure, true);
  assertEquals(scoreCase(post({ at: '2026-11-05T08:00' }), t({ at: null })).tallies.departure, false);
});

Deno.test('F1 punishes a post called a non-post and a non-post called a post', () => {
  const cases = [post(), post(), { id: 'n', text: 't', expect: { isPost: false as const } }];
  const all = [outcome(), outcome(), outcome({ reason: 'not_a_post', extraction: null })];
  assertEquals(isPostF1(cases, all).f1, 1);
  const missed = isPostF1(cases, [outcome(), outcome({ reason: 'not_a_post', extraction: null }), outcome({ reason: 'not_a_post', extraction: null })]);
  assertEquals(Math.round(missed.f1 * 100) / 100, 0.67);
  const invented = isPostF1(cases, [outcome(), outcome(), outcome()]);
  assertEquals(Math.round(invented.f1 * 100) / 100, 0.8);
});

Deno.test('calibration counts cases and right cases per confidence range', () => {
  const b = calibrate([{ confidence: 0.1, right: false }, { confidence: 0.6, right: true }, { confidence: 0.6, right: false }, { confidence: 0.9, right: true }, { confidence: 0.85, right: true }]);
  assertEquals(b.map((x) => [x.from, x.cases, x.right]), [[0, 1, 0], [0.5, 2, 1], [0.85, 2, 2]]);
});

Deno.test('the gate lists the metrics under their minimum and fails a metric with nothing to score', () => {
  const cases = [post()];
  const good = buildReport(cases, [outcome()]);
  assertEquals(gateFailures(good).sort(), ['commercial_recall', 'departure', 'ride_route']); // no labels for these
  const bad = buildReport(cases, [outcome({ extraction: extraction({ direction: 'request' }) })]);
  assert(gateFailures(bad).includes('direction'));
  assertEquals(bad.rates.direction, 0);
});

Deno.test('the report prints every metric with its minimum and the first misses', () => {
  const text = formatReport(buildReport([post()], [outcome({ extraction: extraction({ direction: 'request' }) })]));
  assert(text.includes('direction'));
  assert(text.includes(`min ${THRESHOLDS.direction * 100}%`));
  assert(text.includes('miss c1 direction: expected offer, got request'));
});
