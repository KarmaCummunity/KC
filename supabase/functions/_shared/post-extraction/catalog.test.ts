import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { rpcPlaceResolver } from './catalog.ts';
import { fakeClient, type Call } from './fakeClient.ts';

Deno.test('rows of the RPC become place candidates of the asked level', async () => {
  const calls: Call[] = [];
  const resolve = rpcPlaceResolver(fakeClient({
    api_resolve_place: { data: [{ place_id: '5000', name_he: 'x', city_id: '5000', score: 0.9, margin: 0.4 }] },
  }, calls));
  assertEquals(await resolve('city', 'tel aviv', null), [
    { level: 'city', placeId: '5000', nameHe: 'x', cityId: '5000', score: 0.9, margin: 0.4 },
  ]);
  assertEquals(calls[0][1], { p_level: 'city', p_text: 'tel aviv', p_city_id: null, p_limit: 5 });
});

Deno.test('a street lookup is scoped to its city', async () => {
  const calls: Call[] = [];
  await rpcPlaceResolver(fakeClient({ api_resolve_place: { data: [] } }, calls))('street', 'herzl', '5000');
  assert((calls[0][1] as { p_city_id: string }).p_city_id === '5000');
});

Deno.test('a query the catalog refuses has no candidates; any other error is an error', async () => {
  const refused = rpcPlaceResolver(fakeClient({ api_resolve_place: { error: { message: 'place_query_invalid', code: '22023' } } }));
  assertEquals(await refused('city', 'x', null), []);
  const broken = rpcPlaceResolver(fakeClient({ api_resolve_place: { error: { message: 'down', code: '57P03' } } }));
  await assertRejects(() => broken('city', 'xx', null), Error, 'place resolution');
});

Deno.test('no data at all is no candidates', async () => {
  assertEquals(await rpcPlaceResolver(fakeClient({ api_resolve_place: { data: null } }))('city', 'xx', null), []);
});
