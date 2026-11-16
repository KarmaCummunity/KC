import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { fakeClient, type Call } from './fakeClient.ts';
import { CACHE_TTL_MS, supabaseExtractionCache, supabaseImportStore, type ImportRecord } from './store.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const FP = 'a'.repeat(64);

Deno.test('the member limit counts that member\'s attempts since the instant', async () => {
  const calls: Call[] = [];
  const store = supabaseImportStore(fakeClient({ external_post_imports: { count: 3 } }, calls));
  assertEquals(await store.attemptsSince('u1', '2026-11-16T11:00:00Z'), 3);
  assert(calls.some((c) => c[0] === 'external_post_imports.eq' && c[1] === 'user_id' && c[2] === 'u1'));
  assert(calls.some((c) => c[0] === 'external_post_imports.gte' && c[1] === 'created_at'));
});

Deno.test('the daily budget counts only attempts that called the model', async () => {
  const calls: Call[] = [];
  const store = supabaseImportStore(fakeClient({ external_post_imports: { count: 7 } }, calls));
  assertEquals(await store.providerCallsSince('2026-11-16T00:00:00Z'), 7);
  assert(calls.some((c) => c[0] === 'external_post_imports.eq' && c[1] === 'provider_called' && c[2] === true));
});

Deno.test('a count that fails is an error, not zero (a limit must not silently open)', async () => {
  const store = supabaseImportStore(fakeClient({ external_post_imports: { error: { message: 'down' } } }));
  await assertRejects(() => store.attemptsSince('u1', 'x'), Error, 'import store');
});

Deno.test('recording an attempt returns its id and sends exactly the row', async () => {
  const calls: Call[] = [];
  const store = supabaseImportStore(fakeClient({ external_post_imports: { data: { id: 'row-1' } } }, calls));
  const row: ImportRecord = {
    user_id: 'u1', channel: 'share', source_platform: 'yad2', text_fingerprint: FP, routing: 'confirm', reason: 'ok',
    confidence: 0.9, extraction: { title: 't' }, extraction_version: 'v1', model: 'm', provider_called: true,
  };
  assertEquals(await store.record(row), 'row-1');
  assertEquals(calls.find((c) => c[0] === 'external_post_imports.insert')?.[1], row);
});

Deno.test('a failed insert is an error', async () => {
  const store = supabaseImportStore(fakeClient({ external_post_imports: { error: { message: 'rls' } } }));
  await assertRejects(() => store.record({} as ImportRecord), Error, 'import store');
});

Deno.test('the cache reads only a row of this version that is under a day old', async () => {
  const calls: Call[] = [];
  const cache = supabaseExtractionCache(fakeClient({ post_extraction_cache: { data: { result: { is_post: false } } } }, calls), () => NOW);
  assertEquals(await cache.get(FP, 'v1'), { is_post: false });
  assert(calls.some((c) => c[0] === 'post_extraction_cache.eq' && c[1] === 'fingerprint' && c[2] === FP));
  assert(calls.some((c) => c[0] === 'post_extraction_cache.eq' && c[1] === 'extraction_version' && c[2] === 'v1'));
  const gte = calls.find((c) => c[0] === 'post_extraction_cache.gte');
  assertEquals(gte?.[2], new Date(NOW.getTime() - CACHE_TTL_MS).toISOString());
});

Deno.test('a cache miss is null and a cache error is an error', async () => {
  assertEquals(await supabaseExtractionCache(fakeClient({ post_extraction_cache: { data: null } }), () => NOW).get(FP, 'v1'), null);
  await assertRejects(
    () => supabaseExtractionCache(fakeClient({ post_extraction_cache: { error: { message: 'x' } } }), () => NOW).get(FP, 'v1'),
    Error, 'extraction cache');
});

Deno.test('writing clears expired rows, then replaces the fingerprint\'s row', async () => {
  const calls: Call[] = [];
  const cache = supabaseExtractionCache(fakeClient({ post_extraction_cache: {} }, calls), () => NOW);
  await cache.put(FP, 'v1', { is_post: true });
  const names = calls.map((c) => c[0]);
  assert(names.indexOf('post_extraction_cache.delete') < names.indexOf('post_extraction_cache.upsert'));
  assertEquals(calls.find((c) => c[0] === 'post_extraction_cache.lt')?.[2], new Date(NOW.getTime() - CACHE_TTL_MS).toISOString());
  const [, row, options] = calls.find((c) => c[0] === 'post_extraction_cache.upsert')!;
  assertEquals((row as { fingerprint: string }).fingerprint, FP);
  assertEquals(options, { onConflict: 'fingerprint' });
});
