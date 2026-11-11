import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient, callsTo } from '../../__tests__/fakeBaselineClient';
import {
  directionOf,
  loadPostCatalog,
  postTypeOf,
  requireKindId,
  requireSubcategoryId,
} from '../postCatalog';
import { KIND_ROWS, SUBCATEGORY_ROWS, fail, ok } from './cardFixtures';

describe('post type ↔ direction', () => {
  it('maps a Give to an offer and a Request to a request, and back', () => {
    expect(directionOf('Give')).toBe('offer');
    expect(directionOf('Request')).toBe('request');
    expect(postTypeOf('offer')).toBe('Give');
    expect(postTypeOf('request')).toBe('Request');
    expect(postTypeOf(null)).toBe('Give');
  });
});

describe('loadPostCatalog', () => {
  it('reads the items world once per client and maps slugs to categories', async () => {
    const { client, calls } = createFakeClient({
      tables: { item_subcategories: ok(SUBCATEGORY_ROWS), post_kinds: ok(KIND_ROWS) },
    });

    const catalog = await loadPostCatalog(client);
    await loadPostCatalog(client);

    expect(catalog.subcategoryIdOf.get('Furniture')).toBe('sub-furniture');
    expect(catalog.subcategoryIdOf.get('BabyGear')).toBe('sub-baby');
    expect(catalog.categoryOf.get('sub-books')).toBe('Books');
    expect(catalog.kindIdOf.get('offer')).toBe('kind-offer');
    expect(catalog.kindIdOf.get('request')).toBe('kind-request');
    expect(callsTo(calls, 'item_subcategories')).toHaveLength(1);
    expect(callsTo(calls, 'post_kinds')[0]?.filters).toContainEqual(['eq', 'world_slug', 'items']);
  });

  it('lets one "either" kind serve both directions, and the first kind of a direction win', async () => {
    const { client } = createFakeClient({
      tables: {
        item_subcategories: ok([]),
        post_kinds: ok([
          { id: 'kind-either', direction: 'either' },
          { id: 'kind-later-offer', direction: 'offer' },
        ]),
      },
    });

    const catalog = await loadPostCatalog(client);

    expect(catalog.kindIdOf.get('offer')).toBe('kind-either');
    expect(catalog.kindIdOf.get('request')).toBe('kind-either');
  });

  it('does not cache a failed read', async () => {
    let attempt = 0;
    const { client } = createFakeClient({
      tables: {
        item_subcategories: () => (attempt++ === 0 ? fail('PGRST205', 'no table') : ok(SUBCATEGORY_ROWS)),
        post_kinds: ok(KIND_ROWS),
      },
    });

    await expect(loadPostCatalog(client)).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(loadPostCatalog(client)).resolves.toBeDefined();
  });
});

describe('requireKindId / requireSubcategoryId', () => {
  it('returns the seeded id', async () => {
    const { client } = createFakeClient({
      tables: { item_subcategories: ok(SUBCATEGORY_ROWS), post_kinds: ok(KIND_ROWS) },
    });
    const catalog = await loadPostCatalog(client);

    expect(requireKindId(catalog, 'Give')).toBe('kind-offer');
    expect(requireSubcategoryId(catalog, 'Books')).toBe('sub-books');
  });

  it('is a missing backend object when the catalog lacks the row (degrade rule)', async () => {
    const { client } = createFakeClient({ tables: { item_subcategories: ok([]), post_kinds: ok([]) } });
    const catalog = await loadPostCatalog(client);

    expect(() => requireKindId(catalog, 'Request')).toThrow(BackendUnavailableError);
    expect(() => requireSubcategoryId(catalog, 'Toys')).toThrow(BackendUnavailableError);
  });
});
