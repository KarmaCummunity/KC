import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { fakeClient } from './fakeClient.ts';
import { cachedLists, loadExtractionLists } from './lists.ts';

const catalog = {
  worlds: { data: [{ slug: 'items' }, { slug: 'rides' }, { slug: 'knowledge' }, { slug: 'money' }] },
  item_subcategories: {
    data: [
      { world_slug: 'items', slug: 'furniture' }, { world_slug: 'items', slug: 'books' },
      { world_slug: 'money', slug: 'grants' },
    ],
  },
  post_kinds: {
    data: [
      { world_slug: 'items', detail_schema: { properties: { condition: {}, quantity: {} } } },
      { world_slug: 'items', detail_schema: { properties: { condition: {}, size: {} } } },
      { world_slug: 'rides', detail_schema: { type: 'object' } },
      { world_slug: 'money', detail_schema: { properties: { amount: {} } } },
    ],
  },
};

Deno.test('lists hold the active, publishable worlds with their sub-categories and detail keys', async () => {
  const lists = await loadExtractionLists(fakeClient(catalog));
  assertEquals(lists.worlds, ['items', 'rides', 'knowledge']);
  assertEquals(lists.subcategories, { items: ['furniture', 'books'] });
  assertEquals(lists.detailKeys, { items: ['condition', 'quantity', 'size'], rides: [] });
});

Deno.test('a world that is not active is not offered', async () => {
  const lists = await loadExtractionLists(fakeClient({ ...catalog, worlds: { data: [{ slug: 'items' }] } }));
  assertEquals(lists.worlds, ['items']);
});

Deno.test('a catalog read that fails is an error', async () => {
  await assertRejects(
    () => loadExtractionLists(fakeClient({ ...catalog, worlds: { error: { message: 'down' } } })),
    Error, 'extraction lists',
  );
});

Deno.test('the lists are held for five minutes and then read again', async () => {
  let loads = 0;
  let now = new Date('2026-11-16T12:00:00Z');
  const get = cachedLists(() => { loads++; return Promise.resolve({ worlds: [], subcategories: {}, detailKeys: {} }); }, () => now);
  await get();
  now = new Date(now.getTime() + 4 * 60_000);
  await get();
  assertEquals(loads, 1);
  now = new Date(now.getTime() + 2 * 60_000);
  await get();
  assertEquals(loads, 2);
});
