import { describe, expect, it } from 'vitest';
import { CREATE_CATEGORIES } from '../createCategories';
import { buildListingCreatePayload, buildPostCreatePayload, type PostPayloadArgs } from '../unifiedCreatePayload';

const postBase: PostPayloadArgs = {
  ownerId: 'u1',
  type: 'Give',
  visibility: 'Public',
  title: 'כיסא',
  description: '  ',
  category: 'Furniture' as PostPayloadArgs['category'],
  city: { id: 'c1', name: 'תל אביב' },
  street: 'הרצל',
  streetNumber: '5',
  locationDisplayLevel: 'CityOnly' as PostPayloadArgs['locationDisplayLevel'],
  condition: 'Good' as PostPayloadArgs['condition'],
  urgency: 'דחוף',
  estimatedValue: 100,
  uploads: [{ path: 'p/1.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
  hideFromCounterparty: false,
};

describe('unified create — post payload (items category)', () => {
  it('give: condition + value, no urgency, empty description -> null', () => {
    const p = buildPostCreatePayload(postBase);
    expect(p).toMatchObject({
      type: 'Give', itemCondition: 'Good', estimatedValue: 100, urgency: null, description: null,
      address: { city: 'c1', cityName: 'תל אביב', street: 'הרצל', streetNumber: '5' },
      mediaAssets: [{ path: 'p/1.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    });
  });
  it('request: urgency only, no condition/value', () => {
    const p = buildPostCreatePayload({ ...postBase, type: 'Request', description: 'x' });
    expect(p).toMatchObject({ type: 'Request', itemCondition: null, estimatedValue: null, urgency: 'דחוף', description: 'x' });
    expect(buildPostCreatePayload({ ...postBase, type: 'Request', urgency: ' ' }).urgency).toBeNull();
  });
});

describe('unified create — listing payload per category', () => {
  const listings = CREATE_CATEGORIES.filter((c) => c.engine === 'listing');
  it.each(listings.map((c) => [c.id, c] as const))('%s builds the listing write', (_id, c) => {
    const p = buildListingCreatePayload({
      kindId: `k-${c.id}`, kindDirection: 'either', direction: 'request', title: ' כותרת ', summary: ' ',
      details: { a: 1 }, cityId: 'c1', lat: 1, lng: 2, radiusKm: 25, mediaPaths: ['m'],
      worldSubcategoryId: 'cat-1',
    });
    expect(p).toEqual({
      kindId: `k-${c.id}`, title: 'כותרת', summary: null, details: { a: 1 }, direction: 'request',
      cityId: 'c1', lat: 1, lng: 2, maxRadiusKm: 25, mediaPaths: ['m'], externalBodyId: null,
      categoryId: 'cat-1',
    });
  });
  it('fixed-direction kinds send null direction', () => {
    const p = buildListingCreatePayload({
      kindId: 'k', kindDirection: 'give', direction: 'give', title: 't', summary: 's', details: {},
      cityId: null, lat: null, lng: null, radiusKm: 5, mediaPaths: [], worldSubcategoryId: null,
    });
    expect(p).toMatchObject({ direction: null, summary: 's', externalBodyId: null, categoryId: null });
  });
});
