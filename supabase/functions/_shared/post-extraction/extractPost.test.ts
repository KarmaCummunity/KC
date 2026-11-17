import { assert, assertEquals } from 'jsr:@std/assert@1';
import { extractExternalPost, type ExtractDeps } from './extractPost.ts';
import type { PlaceCandidate, PlaceResolver } from './places.ts';
import { ExtractionProviderError, type ExtractionProviderInput, type PostExtractionProvider } from './providerTypes.ts';

const lists = {
  worlds: ['items', 'food', 'rides', 'time', 'knowledge'],
  subcategories: { items: ['furniture'] },
  detailKeys: {},
};
// Wednesday 4 Nov 2026, 12:00 in Israel (UTC+2).
const NOW = new Date('2026-11-04T10:00:00Z');

const base = {
  is_post: true, reject_reason: null, direction: 'offer', world_slug: 'items', subcategory: 'furniture',
  title: 'ספה תלת מושבית', description: 'במצב טוב', place: { city_text: 'תל אביב', street_text: null, neighborhood_text: null },
  time: { kind: 'none' }, ride: null, details: {}, language: 'he',
  confidence: { overall: 0.95, per_field: { direction: 0.95, world: 0.95, title: 0.95, city: 0.95 } },
};

const city = (id: string, score: number, margin: number): PlaceCandidate => ({
  level: 'city', placeId: id, nameHe: `city${id}`, cityId: id, score, margin,
});

/** A provider answering from a queue; the inputs it saw are recorded. */
function fakeProvider(answers: (unknown | Error)[], seen: ExtractionProviderInput[] = []): PostExtractionProvider {
  return {
    extract: (input) => {
      seen.push(input);
      const next = answers.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ raw: next, model: 'fake-model' });
    },
  };
}

function deps(provider: PostExtractionProvider, resolvePlace?: PlaceResolver): ExtractDeps {
  return { provider, lists, now: () => NOW, resolvePlace: resolvePlace ?? (() => Promise.resolve([city('5000', 0.9, 0.5)])) };
}

Deno.test('a clear offer is routed to confirm with the city picked and highlighted', async () => {
  const out = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה תלת מושבית בתל אביב');
  assertEquals(out.reason, 'ok');
  assertEquals(out.routing, 'confirm'); // an auto-picked city always needs a look (FR-IMPORT-004 AC3)
  assertEquals(out.city?.status, 'picked');
  assertEquals(out.city?.picked?.placeId, '5000');
  assert(out.confirmFields.includes('city'));
  assertEquals(out.model, 'fake-model');
  assertEquals(out.extraction?.worldSlug, 'items');
});

Deno.test('a post that needs no place and reads clearly is ready', async () => {
  const raw = { ...base, world_slug: 'knowledge', subcategory: null, place: { city_text: null } };
  const out = await extractExternalPost(deps(fakeProvider([raw])), 'מוסר שיעורים פרטיים בחשבון');
  assertEquals(out.routing, 'ready');
  assertEquals(out.confirmFields, []);
});

Deno.test('contact details never reach the provider and the removal is reported', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([base], seen)), 'מוסר ספה, התקשרו 050-1234567 או a@b.com');
  assert(!seen[0].text.includes('050'));
  assert(!seen[0].text.includes('a@b.com'));
  assert(seen[0].text.includes('<PHONE>'));
  assertEquals(out.removed?.phone, 1);
  assertEquals(out.removed?.email, 1);
});

Deno.test('the message timestamp is passed to the provider and resolves relative time', async () => {
  const seen: ExtractionProviderInput[] = [];
  const raw = { ...base, time: { kind: 'relative_day', day_offset: 1, time_hhmm: '08:00' } };
  const out = await extractExternalPost(deps(fakeProvider([raw], seen)), '4.11.2026, 12:03 - דנה: מוסר ספה מחר ב-8');
  assertEquals(seen[0].messageAtIso, '2026-11-04T10:03:00.000Z');
  assertEquals(out.time?.dateIso, '2026-11-05');
  assertEquals(out.time?.at?.toISOString(), '2026-11-05T06:00:00.000Z');
  assert(out.confirmFields.includes('time')); // a bare hour is a guess the member confirms
});

Deno.test('a provider failure ends in the manual route, not an exception', async () => {
  const out = await extractExternalPost(deps(fakeProvider([new ExtractionProviderError('timeout', 'slow')])), 'מוסר ספה');
  assertEquals(out.routing, 'manual');
  assertEquals(out.reason, 'provider_failed');
  assertEquals(out.extraction, null);
});

Deno.test('an invalid answer is retried once and the second answer is used', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([{ is_post: 'yes' }, base], seen)), 'מוסר ספה');
  assertEquals(seen.length, 2);
  assertEquals(out.reason, 'ok');
});

Deno.test('two invalid answers end in the manual route', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([{ direction: 'sell' }, 'junk'], seen)), 'מוסר ספה');
  assertEquals(seen.length, 2);
  assertEquals(out.routing, 'manual');
  assertEquals(out.reason, 'invalid_result');
});

Deno.test('a text with nothing readable never calls the provider', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([base], seen)), '050-1234567 !!!');
  assertEquals(seen.length, 0);
  assertEquals(out.reason, 'empty_text');
  assertEquals(out.routing, 'manual');
});

Deno.test('a non-post and a commercial ad are routed to manual with their reason', async () => {
  const chat = await extractExternalPost(deps(fakeProvider([{ is_post: false, reject_reason: 'not_a_post' }])), 'תודה רבה לכולם');
  assertEquals([chat.routing, chat.reason], ['manual', 'not_a_post']);
  const ad = await extractExternalPost(deps(fakeProvider([{ ...base, reject_reason: 'commercial' }])), 'ספה למכירה 500 ש"ח');
  assertEquals([ad.routing, ad.reason], ['manual', 'rejected']);
  assertEquals(ad.extraction?.rejectReason, 'commercial');
});

Deno.test('a city with a close rival is suggested, never picked', async () => {
  const resolve: PlaceResolver = () => Promise.resolve([city('1', 0.9, 0.05), city('2', 0.85, 0.85)]);
  const out = await extractExternalPost(deps(fakeProvider([base]), resolve), 'מוסר ספה בגן');
  assertEquals(out.city?.status, 'suggest');
  assertEquals(out.city?.suggestions.length, 2);
  assertEquals(out.routing, 'confirm');
});

Deno.test('a street is looked up only inside a picked city', async () => {
  const calls: string[] = [];
  const resolve: PlaceResolver = (level, _text, cityId) => {
    calls.push(`${level}:${cityId}`);
    return Promise.resolve(level === 'city'
      ? [city('5000', 0.9, 0.5)]
      : [{ level: 'street', placeId: '101', nameHe: 's', cityId: '5000', score: 1, margin: 0.5 }]);
  };
  const raw = { ...base, place: { city_text: 'תל אביב', street_text: 'הרצל' } };
  const out = await extractExternalPost(deps(fakeProvider([raw]), resolve), 'מוסר ספה ברחוב הרצל בתל אביב');
  assertEquals(calls, ['city:null', 'street:5000']);
  assertEquals(out.street?.picked?.placeId, '101');
  assert(out.confirmFields.includes('street'));
});

Deno.test('a ride resolves its route against cities and junctions', async () => {
  const resolve: PlaceResolver = (level, text) =>
    Promise.resolve(level === 'city' ? [city(text === 'חיפה' ? 'H' : 'T', 0.95, 0.9)] : []);
  const raw = {
    ...base, world_slug: 'rides', subcategory: null, place: { city_text: null },
    ride: { origin_text: 'חיפה', destination_text: 'תל אביב', meeting_texts: [], seats: 3 },
  };
  const out = await extractExternalPost(deps(fakeProvider([raw]), resolve), 'נוסע מחיפה לתל אביב, 3 מקומות');
  assertEquals(out.ride?.origin.picked?.placeId, 'H');
  assertEquals(out.ride?.destination.picked?.placeId, 'T');
  assert(out.confirmFields.includes('origin'));
});

Deno.test('a conflicting offer and request in one text can never be ready', async () => {
  const out = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה ומחפש שולחן');
  assert(out.routing !== 'ready');
  assert(out.confidence <= 0.4);
});

Deno.test('the fingerprint is a SHA-256 of the canonical text and ignores contact details and punctuation', async () => {
  const a = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה!!! קומה 3, 050-1234567');
  const b = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה קומה 4  052-7654321');
  assert(/^[0-9a-f]{64}$/.test(a.fingerprint!));
  assertEquals(a.fingerprint, b.fingerprint);
});

/** An in-memory cache that records what happened to it. */
function memoryCache(initial: Record<string, unknown> = {}, failing = false) {
  const store = new Map(Object.entries(initial));
  const log: string[] = [];
  return {
    store, log,
    get: (fp: string, version: string) => {
      log.push(`get:${version}`);
      if (failing) return Promise.reject(new Error('cache down'));
      return Promise.resolve(store.get(fp) ?? null);
    },
    put: (fp: string, version: string, value: unknown) => {
      log.push(`put:${version}`);
      if (failing) return Promise.reject(new Error('cache down'));
      store.set(fp, value);
      return Promise.resolve();
    },
  };
}

Deno.test('a validated answer is cached and the same text is then answered without the provider', async () => {
  const cache = memoryCache();
  const seen: ExtractionProviderInput[] = [];
  const first = await extractExternalPost({ ...deps(fakeProvider([base], seen)), cache }, 'מוסר ספה בתל אביב');
  assertEquals([first.providerCalled, first.cacheHit], [true, false]);
  assertEquals(cache.store.size, 1);
  const second = await extractExternalPost({ ...deps(fakeProvider([], seen)), cache }, 'מוסר ספה בתל אביב!');
  assertEquals([second.providerCalled, second.cacheHit, second.model], [false, true, 'cache']);
  assertEquals(seen.length, 1);
  assertEquals(second.extraction?.title, first.extraction?.title);
});

Deno.test('a cached answer still goes through resolution: the time follows the new message', async () => {
  const cache = memoryCache();
  const raw = { ...base, time: { kind: 'relative_day', day_offset: 1, time_hhmm: '17:00' } };
  await extractExternalPost({ ...deps(fakeProvider([raw])), cache }, 'מוסר ספה מחר ב-17');
  const again = await extractExternalPost({ ...deps(fakeProvider([])), cache }, '5.11.2026, 09:00 - דנה: מוסר ספה מחר ב-17');
  assertEquals(again.cacheHit, true);
  assertEquals(again.time?.dateIso, '2026-11-06');
});

Deno.test('a cache that fails or holds garbage never fails the extraction', async () => {
  const down = await extractExternalPost({ ...deps(fakeProvider([base])), cache: memoryCache({}, true) }, 'מוסר ספה');
  assertEquals(down.reason, 'ok');
  assertEquals(down.providerCalled, true);
  const fp = (await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה')).fingerprint!;
  const broken = await extractExternalPost({ ...deps(fakeProvider([base])), cache: memoryCache({ [fp]: { is_post: 'maybe' } }) }, 'מוסר ספה');
  assertEquals([broken.reason, broken.providerCalled], ['ok', true]);
});

Deno.test('a failed extraction is never cached', async () => {
  const cache = memoryCache();
  await extractExternalPost({ ...deps(fakeProvider([{ direction: 'sell' }, 'junk'])), cache }, 'מוסר ספה');
  await extractExternalPost({ ...deps(fakeProvider([new ExtractionProviderError('http', 'x')])), cache }, 'מוסר כיסא');
  assertEquals(cache.store.size, 0);
});
