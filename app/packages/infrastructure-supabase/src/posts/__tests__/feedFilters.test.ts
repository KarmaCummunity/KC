import { describe, expect, it } from 'vitest';
import type { PostFeedFilter, PostWithOwner } from '@kc/application';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { buildFeedFilters, narrowPage } from '../feedFilters';
import { loadPostCatalog } from '../postCatalog';
import { mapCardToPostWithOwner } from '../mapPostRow';
import { KIND_ROWS, SUBCATEGORY_ROWS, makeCard, ok } from './cardFixtures';

async function catalog() {
  const { client } = createFakeClient({
    tables: { item_subcategories: ok(SUBCATEGORY_ROWS), post_kinds: ok(KIND_ROWS) },
  });
  return loadPostCatalog(client);
}

describe('buildFeedFilters', () => {
  it('sends only the sort for an empty filter (newest is the port default)', async () => {
    expect(buildFeedFilters({}, await catalog())).toEqual({ sort: 'newest' });
  });

  it('maps every term of the filter sheet to a key of p_filters', async () => {
    const filter: PostFeedFilter = {
      type: 'Give',
      categories: ['Furniture', 'Books'],
      worlds: ['items'],
      subcategories: ['sub-extra'],
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: 25 },
      statusFilter: 'all',
      sortOrder: 'distance',
      proximitySortCity: 'IL-002',
      followersOnly: true,
      searchQuery: '  sofa ',
    };

    expect(buildFeedFilters(filter, await catalog())).toEqual({
      sort: 'nearest',
      direction: 'offer',
      world: 'items',
      item_subcategory_ids: ['sub-furniture', 'sub-books', 'sub-extra'],
      status: 'all',
      audience: 'following',
      city_id: 'IL-001',
      radius_km: 25,
      near_city_id: 'IL-002',
      q: 'sofa',
    });
  });

  it('maps the other sorts, a request and ignores a one-character query', async () => {
    const cat = await catalog();
    expect(buildFeedFilters({ sortOrder: 'oldest' }, cat)).toMatchObject({ sort: 'oldest' });
    expect(buildFeedFilters({ sortOrder: 'personalized' }, cat)).toMatchObject({ sort: 'recommended' });
    expect(buildFeedFilters({ type: 'Request', searchQuery: 'a' }, cat)).toEqual({ sort: 'newest', direction: 'request' });
  });

  it('does not send several worlds (they are narrowed on the page)', async () => {
    expect(buildFeedFilters({ worlds: ['items', 'food'] }, await catalog())).not.toHaveProperty('world');
  });
});

describe('narrowPage', () => {
  async function posts(): Promise<PostWithOwner[]> {
    const cat = await catalog();
    return [
      mapCardToPostWithOwner(makeCard({ id: 'a', details: { item_condition: 'New' } }), { catalog: cat }),
      mapCardToPostWithOwner(makeCard({ id: 'b', details: { item_condition: 'Fair' } }), { catalog: cat }),
      mapCardToPostWithOwner(makeCard({ id: 'c', world_slug: 'food', details: {} }), { catalog: cat }),
    ];
  }

  it('keeps everything when the filter has no such terms', async () => {
    expect(narrowPage(await posts(), {}).map((p) => p.postId)).toEqual(['a', 'b', 'c']);
  });

  it('narrows to the chosen worlds when there are several', async () => {
    const page = narrowPage(await posts(), { worlds: ['items', 'rides'] });
    expect(page.map((p) => p.postId)).toEqual(['a', 'b']);
  });

  it('applies the item condition to a Give filter only', async () => {
    const give = narrowPage(await posts(), { type: 'Give', itemConditions: ['New'] });
    expect(give.map((p) => p.postId)).toEqual(['a']);
    const any = narrowPage(await posts(), { itemConditions: ['New'] });
    expect(any).toHaveLength(3);
  });
});
