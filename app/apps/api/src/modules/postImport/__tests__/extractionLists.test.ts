import { expect, it } from 'vitest';
import { cachedLists, loadExtractionLists } from '../extractionLists';
import { fakeClient } from './fakeClient';

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

it('lists hold the active, publishable worlds with their sub-categories and detail keys', async () => {
  const lists = await loadExtractionLists(fakeClient(catalog));
  expect(lists.worlds).toEqual(['items', 'rides', 'knowledge']);
  expect(lists.subcategories).toEqual({ items: ['furniture', 'books'] });
  expect(lists.detailKeys).toEqual({ items: ['condition', 'quantity', 'size'], rides: [] });
});

it('a world that is not active is not offered', async () => {
  const lists = await loadExtractionLists(fakeClient({ ...catalog, worlds: { data: [{ slug: 'items' }] } }));
  expect(lists.worlds).toEqual(['items']);
});

it('a catalog read that fails is an error', async () => {
  await expect(loadExtractionLists(fakeClient({ ...catalog, worlds: { error: { message: 'down' } } }))).rejects.toThrow('extraction lists');
});

it('the lists are held for five minutes and then read again', async () => {
  let loads = 0;
  let now = new Date('2026-11-16T12:00:00Z');
  const get = cachedLists(() => { loads++; return Promise.resolve({ worlds: [], subcategories: {}, detailKeys: {} }); }, () => now);
  await get();
  now = new Date(now.getTime() + 4 * 60_000);
  await get();
  expect(loads).toEqual(1);
  now = new Date(now.getTime() + 2 * 60_000);
  await get();
  expect(loads).toEqual(2);
});
