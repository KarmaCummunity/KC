import { GeminiError } from '../../../platform/ai/geminiClient';
import { expect, it } from 'vitest';
import { type ExtractDeps, extractExternalPost } from '../extractPost';
import type { ExtractionProviderInput, PostExtractionProvider } from '../extractionProvider';
import type { PlaceCandidate, PlaceResolver } from '../placeDecision';

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

it('a clear offer is routed to confirm with the city picked and highlighted', async () => {
  const out = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה תלת מושבית בתל אביב');
  expect(out.reason).toEqual('ok');
  expect(out.routing).toEqual('confirm'); // an auto-picked city always needs a look (FR-IMPORT-004 AC3)
  expect(out.city?.status).toEqual('picked');
  expect(out.city?.picked?.placeId).toEqual('5000');
  expect(out.confirmFields.includes('city')).toBe(true);
  expect(out.model).toEqual('fake-model');
  expect(out.extraction?.worldSlug).toEqual('items');
});

it('a post that needs no place and reads clearly is ready', async () => {
  const raw = { ...base, world_slug: 'knowledge', subcategory: null, place: { city_text: null } };
  const out = await extractExternalPost(deps(fakeProvider([raw])), 'מוסר שיעורים פרטיים בחשבון');
  expect(out.routing).toEqual('ready');
  expect(out.confirmFields).toEqual([]);
});

it('contact details never reach the provider and the removal is reported', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([base], seen)), 'מוסר ספה, התקשרו 050-1234567 או a@b.com');
  expect(!seen[0]?.text.includes('050')).toBe(true);
  expect(!seen[0]?.text.includes('a@b.com')).toBe(true);
  expect(seen[0]?.text.includes('<PHONE>')).toBe(true);
  expect(out.removed?.phone).toEqual(1);
  expect(out.removed?.email).toEqual(1);
});

it('the message timestamp is passed to the provider and resolves relative time', async () => {
  const seen: ExtractionProviderInput[] = [];
  const raw = { ...base, time: { kind: 'relative_day', day_offset: 1, time_hhmm: '08:00' } };
  const out = await extractExternalPost(deps(fakeProvider([raw], seen)), '4.11.2026, 12:03 - דנה: מוסר ספה מחר ב-8');
  expect(seen[0]?.messageAtIso).toEqual('2026-11-04T10:03:00.000Z');
  expect(out.time?.dateIso).toEqual('2026-11-05');
  expect(out.time?.at?.toISOString()).toEqual('2026-11-05T06:00:00.000Z');
  expect(out.confirmFields.includes('time')).toBe(true); // a bare hour is a guess the member confirms
});

it('a provider failure ends in the manual route, not an exception', async () => {
  const out = await extractExternalPost(deps(fakeProvider([new GeminiError('timeout', 'slow')])), 'מוסר ספה');
  expect(out.routing).toEqual('manual');
  expect(out.reason).toEqual('provider_failed');
  expect(out.extraction).toEqual(null);
});

it('an invalid answer is retried once and the second answer is used', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([{ is_post: 'yes' }, base], seen)), 'מוסר ספה');
  expect(seen.length).toEqual(2);
  expect(out.reason).toEqual('ok');
});

it('two invalid answers end in the manual route', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([{ direction: 'sell' }, 'junk'], seen)), 'מוסר ספה');
  expect(seen.length).toEqual(2);
  expect(out.routing).toEqual('manual');
  expect(out.reason).toEqual('invalid_result');
});

it('a text with nothing readable never calls the provider', async () => {
  const seen: ExtractionProviderInput[] = [];
  const out = await extractExternalPost(deps(fakeProvider([base], seen)), '050-1234567 !!!');
  expect(seen.length).toEqual(0);
  expect(out.reason).toEqual('empty_text');
  expect(out.routing).toEqual('manual');
});

it('a non-post and a commercial ad are routed to manual with their reason', async () => {
  const chat = await extractExternalPost(deps(fakeProvider([{ is_post: false, reject_reason: 'not_a_post' }])), 'תודה רבה לכולם');
  expect([chat.routing, chat.reason]).toEqual(['manual', 'not_a_post']);
  const ad = await extractExternalPost(deps(fakeProvider([{ ...base, reject_reason: 'commercial' }])), 'ספה למכירה 500 ש"ח');
  expect([ad.routing, ad.reason]).toEqual(['manual', 'rejected']);
  expect(ad.extraction?.rejectReason).toEqual('commercial');
});

it('a city with a close rival is suggested, never picked', async () => {
  const resolve: PlaceResolver = () => Promise.resolve([city('1', 0.9, 0.05), city('2', 0.85, 0.85)]);
  const out = await extractExternalPost(deps(fakeProvider([base]), resolve), 'מוסר ספה בגן');
  expect(out.city?.status).toEqual('suggest');
  expect(out.city?.suggestions.length).toEqual(2);
  expect(out.routing).toEqual('confirm');
});

it('a street is looked up only inside a picked city', async () => {
  const calls: string[] = [];
  const resolve: PlaceResolver = (level, _text, cityId) => {
    calls.push(`${level}:${cityId}`);
    return Promise.resolve(level === 'city'
      ? [city('5000', 0.9, 0.5)]
      : [{ level: 'street', placeId: '101', nameHe: 's', cityId: '5000', score: 1, margin: 0.5 }]);
  };
  const raw = { ...base, place: { city_text: 'תל אביב', street_text: 'הרצל' } };
  const out = await extractExternalPost(deps(fakeProvider([raw]), resolve), 'מוסר ספה ברחוב הרצל בתל אביב');
  expect(calls).toEqual(['city:null', 'street:5000']);
  expect(out.street?.picked?.placeId).toEqual('101');
  expect(out.confirmFields.includes('street')).toBe(true);
});

it('a ride resolves its route against cities and junctions', async () => {
  const resolve: PlaceResolver = (level, text) =>
    Promise.resolve(level === 'city' ? [city(text === 'חיפה' ? 'H' : 'T', 0.95, 0.9)] : []);
  const raw = {
    ...base, world_slug: 'rides', subcategory: null, place: { city_text: null },
    ride: { origin_text: 'חיפה', destination_text: 'תל אביב', meeting_texts: [], seats: 3 },
  };
  const out = await extractExternalPost(deps(fakeProvider([raw]), resolve), 'נוסע מחיפה לתל אביב, 3 מקומות');
  expect(out.ride?.origin.picked?.placeId).toEqual('H');
  expect(out.ride?.destination.picked?.placeId).toEqual('T');
  expect(out.confirmFields.includes('origin')).toBe(true);
});

it('a conflicting offer and request in one text can never be ready', async () => {
  const out = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה ומחפש שולחן');
  expect(out.routing !== 'ready').toBe(true);
  expect(out.confidence <= 0.4).toBe(true);
});

it('the fingerprint is a SHA-256 of the canonical text and ignores contact details and punctuation', async () => {
  const a = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה!!! קומה 3, 050-1234567');
  const b = await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה קומה 4  052-7654321');
  expect(/^[0-9a-f]{64}$/.test(a.fingerprint!)).toBe(true);
  expect(a.fingerprint).toEqual(b.fingerprint);
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

it('a validated answer is cached and the same text is then answered without the provider', async () => {
  const cache = memoryCache();
  const seen: ExtractionProviderInput[] = [];
  const first = await extractExternalPost({ ...deps(fakeProvider([base], seen)), cache }, 'מוסר ספה בתל אביב');
  expect([first.providerCalled, first.cacheHit]).toEqual([true, false]);
  expect(cache.store.size).toEqual(1);
  const second = await extractExternalPost({ ...deps(fakeProvider([], seen)), cache }, 'מוסר ספה בתל אביב!');
  expect([second.providerCalled, second.cacheHit, second.model]).toEqual([false, true, 'cache']);
  expect(seen.length).toEqual(1);
  expect(second.extraction?.title).toEqual(first.extraction?.title);
});

it('a cached answer still goes through resolution: the time follows the new message', async () => {
  const cache = memoryCache();
  const raw = { ...base, time: { kind: 'relative_day', day_offset: 1, time_hhmm: '17:00' } };
  await extractExternalPost({ ...deps(fakeProvider([raw])), cache }, 'מוסר ספה מחר ב-17');
  const again = await extractExternalPost({ ...deps(fakeProvider([])), cache }, '5.11.2026, 09:00 - דנה: מוסר ספה מחר ב-17');
  expect(again.cacheHit).toEqual(true);
  expect(again.time?.dateIso).toEqual('2026-11-06');
});

it('a cache that fails or holds garbage never fails the extraction', async () => {
  const down = await extractExternalPost({ ...deps(fakeProvider([base])), cache: memoryCache({}, true) }, 'מוסר ספה');
  expect(down.reason).toEqual('ok');
  expect(down.providerCalled).toEqual(true);
  const fp = (await extractExternalPost(deps(fakeProvider([base])), 'מוסר ספה')).fingerprint!;
  const broken = await extractExternalPost({ ...deps(fakeProvider([base])), cache: memoryCache({ [fp]: { is_post: 'maybe' } }) }, 'מוסר ספה');
  expect([broken.reason, broken.providerCalled]).toEqual(['ok', true]);
});

it('a failed extraction is never cached', async () => {
  const cache = memoryCache();
  await extractExternalPost({ ...deps(fakeProvider([{ direction: 'sell' }, 'junk'])), cache }, 'מוסר ספה');
  await extractExternalPost({ ...deps(fakeProvider([new GeminiError('http', 'x')])), cache }, 'מוסר כיסא');
  expect(cache.store.size).toEqual(0);
});
