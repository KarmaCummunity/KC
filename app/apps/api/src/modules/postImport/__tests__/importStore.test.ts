import { expect, it } from 'vitest';
import { CACHE_TTL_MS, createSqlExtractionCache, createSqlImportStore, createSqlPlaceResolver, type ImportRecord } from '../importStore';
import { type Call, fakeClient } from './fakeClient';

const NOW = new Date('2026-11-16T12:00:00Z');
const FP = 'a'.repeat(64);

it('the member limit counts that member\'s attempts since the instant', async () => {
  const calls: Call[] = [];
  const store = createSqlImportStore(fakeClient({ external_post_imports: { count: 3 } }, calls));
  expect(await store.attemptsSince('u1', '2026-11-16T11:00:00Z')).toEqual(3);
  expect(calls.some((c) => c[0] === 'external_post_imports.eq' && c[1] === 'user_id' && c[2] === 'u1')).toBe(true);
  expect(calls.some((c) => c[0] === 'external_post_imports.gte' && c[1] === 'created_at')).toBe(true);
});

it('the daily budget counts only attempts that called the model', async () => {
  const calls: Call[] = [];
  const store = createSqlImportStore(fakeClient({ external_post_imports: { count: 7 } }, calls));
  expect(await store.providerCallsSince('2026-11-16T00:00:00Z')).toEqual(7);
  expect(calls.some((c) => c[0] === 'external_post_imports.eq' && c[1] === 'provider_called' && c[2] === true)).toBe(true);
});

it('a count that fails is an error, not zero (a limit must not silently open)', async () => {
  const store = createSqlImportStore(fakeClient({ external_post_imports: { error: { message: 'down' } } }));
  await expect(store.attemptsSince('u1', 'x')).rejects.toThrow('import store');
});

it('the lockout reads the member\'s moderation removals since the instant', async () => {
  const calls: Call[] = [];
  const store = createSqlImportStore(fakeClient({ import_moderation_removals: { data: ['2026-11-10T08:00:00Z'] } }, calls));
  const removals = await store.moderationRemovalsSince('u1', '2026-10-03T12:00:00Z');
  expect(removals.map((d) => d.toISOString())).toEqual(['2026-11-10T08:00:00.000Z']);
  expect(calls[0]).toEqual(['rpc.import_moderation_removals', { p_user_id: 'u1', p_since: '2026-10-03T12:00:00Z' }]);
});

it('a failed removals read is an error, not an open lockout', async () => {
  const store = createSqlImportStore(fakeClient({ import_moderation_removals: { error: { message: 'down' } } }));
  await expect(store.moderationRemovalsSince('u1', 'x')).rejects.toThrow('import store');
});

it('the cross-post guard asks for the member\'s open post at the threshold', async () => {
  const calls: Call[] = [];
  const store = createSqlImportStore(fakeClient({ import_similar_open_post: { data: [{ post_id: 'p9', similarity: 0.91 }] } }, calls));
  expect(await store.similarOpenPost('u1', 'sofa haifa')).toEqual('p9');
  expect(calls[0]).toEqual(['rpc.import_similar_open_post', { p_user_id: 'u1', p_text: 'sofa haifa', p_min: 0.8 }]);
});

it('no similar post is null; a failed read is an error', async () => {
  expect(await createSqlImportStore(fakeClient({ import_similar_open_post: { data: [] } })).similarOpenPost('u1', 'x')).toEqual(null);
  const failing = createSqlImportStore(fakeClient({ import_similar_open_post: { error: { message: 'down' } } }));
  await expect(failing.similarOpenPost('u1', 'x')).rejects.toThrow('import store');
});

it('recording an attempt returns its id and sends exactly the row', async () => {
  const calls: Call[] = [];
  const store = createSqlImportStore(fakeClient({ external_post_imports: { data: { id: 'row-1' } } }, calls));
  const row: ImportRecord = {
    user_id: 'u1', channel: 'share', source_platform: 'yad2', text_fingerprint: FP, routing: 'confirm', reason: 'ok',
    confidence: 0.9, extraction: { title: 't' }, extraction_version: 'v1', model: 'm', provider_called: true, duplicate_post_id: null,
  };
  expect(await store.record(row)).toEqual('row-1');
  expect(calls.find((c) => c[0] === 'external_post_imports.insert')?.[1]).toEqual(row);
});

it('a failed insert is an error', async () => {
  const store = createSqlImportStore(fakeClient({ external_post_imports: { error: { message: 'rls' } } }));
  await expect(store.record({} as ImportRecord)).rejects.toThrow('import store');
});

it('the cache reads only a row of this version that is under a day old', async () => {
  const calls: Call[] = [];
  const cache = createSqlExtractionCache(fakeClient({ post_extraction_cache: { data: { result: { is_post: false } } } }, calls), () => NOW);
  expect(await cache.get(FP, 'v1')).toEqual({ is_post: false });
  expect(calls.some((c) => c[0] === 'post_extraction_cache.eq' && c[1] === 'fingerprint' && c[2] === FP)).toBe(true);
  expect(calls.some((c) => c[0] === 'post_extraction_cache.eq' && c[1] === 'extraction_version' && c[2] === 'v1')).toBe(true);
  const gte = calls.find((c) => c[0] === 'post_extraction_cache.gte');
  expect(gte?.[2]).toEqual(new Date(NOW.getTime() - CACHE_TTL_MS).toISOString());
});

it('a cache miss is null and a cache error is an error', async () => {
  expect(await createSqlExtractionCache(fakeClient({ post_extraction_cache: { data: null } }), () => NOW).get(FP, 'v1')).toEqual(null);
  await expect(createSqlExtractionCache(fakeClient({ post_extraction_cache: { error: { message: 'x' } } }), () => NOW).get(FP, 'v1')).rejects.toThrow('extraction cache');
});

it('writing clears expired rows, then replaces the fingerprint\'s row', async () => {
  const calls: Call[] = [];
  const cache = createSqlExtractionCache(fakeClient({ post_extraction_cache: {} }, calls), () => NOW);
  await cache.put(FP, 'v1', { is_post: true });
  const names = calls.map((c) => c[0]);
  expect(names.indexOf('post_extraction_cache.delete') < names.indexOf('post_extraction_cache.upsert')).toBe(true);
  expect(calls.find((c) => c[0] === 'post_extraction_cache.lt')?.[2]).toEqual(new Date(NOW.getTime() - CACHE_TTL_MS).toISOString());
  const [, row, options] = calls.find((c) => c[0] === 'post_extraction_cache.upsert')!;
  expect((row as { fingerprint: string }).fingerprint).toEqual(FP);
  expect(options).toEqual({ onConflict: 'fingerprint' });
});


it('rows of the RPC become place candidates of the asked level', async () => {
  const calls: Call[] = [];
  const resolve = createSqlPlaceResolver(fakeClient({
    api_resolve_place: { data: [{ place_id: '5000', name_he: 'x', city_id: '5000', score: 0.9, margin: 0.4 }] },
  }, calls));
  expect(await resolve('city', 'tel aviv', null)).toEqual([
    { level: 'city', placeId: '5000', nameHe: 'x', cityId: '5000', score: 0.9, margin: 0.4 },
  ]);
  expect(calls[0]?.[1]).toEqual({ p_level: 'city', p_text: 'tel aviv', p_city_id: null, p_limit: 5 });
});

it('a street lookup is scoped to its city', async () => {
  const calls: Call[] = [];
  await createSqlPlaceResolver(fakeClient({ api_resolve_place: { data: [] } }, calls))('street', 'herzl', '5000');
  expect((calls[0]?.[1] as { p_city_id: string }).p_city_id === '5000').toBe(true);
});

it('a query the catalog refuses has no candidates; any other error is an error', async () => {
  const refused = createSqlPlaceResolver(fakeClient({ api_resolve_place: { error: { message: 'place_query_invalid', code: '22023' } } }));
  expect(await refused('city', 'x', null)).toEqual([]);
  const broken = createSqlPlaceResolver(fakeClient({ api_resolve_place: { error: { message: 'down', code: '57P03' } } }));
  await expect(broken('city', 'xx', null)).rejects.toThrow('place resolution');
});

it('no data at all is no candidates', async () => {
  expect(await createSqlPlaceResolver(fakeClient({ api_resolve_place: { data: null } }))('city', 'xx', null)).toEqual([]);
});
