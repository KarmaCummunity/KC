import { describe, expect, it } from 'vitest';
import { ORG_EVENT_KIND_SLUG, manualImportDraft, type ExtractedPost, type ImportDraft, type ListingKindOption, type WorldSubcategory } from '@kc/domain';
import { importSeedFromDraft } from '../importSeed';

const kinds: ListingKindOption[] = [
  { kindId: 'k1', slug: 'item_give', labelEn: 'Give', labelHe: 'x', direction: 'give', detailSchema: {} },
  { kindId: 'k2', slug: 'item_request', labelEn: 'Request', labelHe: 'x', direction: 'request', detailSchema: {} },
  { kindId: 'k3', slug: ORG_EVENT_KIND_SLUG, labelEn: 'Event', labelHe: 'x', direction: 'give', detailSchema: {} },
];
const subcategories: WorldSubcategory[] = [
  { categoryId: 'cat-furniture', slug: 'furniture', labelHe: 'x', labelEn: null },
  { categoryId: 'cat-books', slug: 'books', labelHe: 'x', labelEn: null },
];
const context = { kinds, subcategories };

const extraction = (over: Partial<ExtractedPost> = {}): ExtractedPost => ({
  isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'items', subcategory: 'furniture', title: 'Sofa', description: 'Three seats',
  place: { cityText: null, streetText: null, neighborhoodText: null },
  time: { kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null, timeHhmm: null, timePeriod: null, recurringWeekdays: [] },
  ride: null, details: {}, language: 'he', confidence: { overall: 0.9, perField: {} }, ...over,
});
const draft = (over: Partial<ImportDraft> = {}): ImportDraft => ({
  ...manualImportDraft('ok'), routing: 'confirm', extraction: extraction(), confirmFields: ['city'], ...over,
});
const picked = { status: 'picked', suggestions: [], picked: { level: 'city', placeId: '5000', nameHe: 'Tel Aviv', cityId: '5000', score: 0.9, margin: 0.5 } } as const;

describe('importSeedFromDraft', () => {
  it('maps a clear offer to the form: category, give, its kind, sub-category, texts', () => {
    expect(importSeedFromDraft(draft(), context)).toEqual({
      categoryId: 'items', direction: 'give', kindSlug: 'item_give', worldSubcategoryId: 'cat-furniture',
      title: 'Sofa', description: 'Three seats', city: null, confirmFields: ['city'],
    });
  });

  it('a request maps to the request direction and kind', () => {
    const seed = importSeedFromDraft(draft({ extraction: extraction({ direction: 'request' }) }), context);
    expect(seed).toMatchObject({ direction: 'request', kindSlug: 'item_request' });
  });

  it('an unknown direction leaves direction and kind for the member', () => {
    expect(importSeedFromDraft(draft({ extraction: extraction({ direction: 'unknown' }) }), context)).toMatchObject({ direction: null, kindSlug: null });
  });

  it('the organization event kind is never chosen for a member', () => {
    const onlyEvent = [kinds[2]];
    expect(importSeedFromDraft(draft(), { kinds: onlyEvent, subcategories })).toMatchObject({ kindSlug: null });
  });

  it('only a picked city is carried, as the form holds it', () => {
    expect(importSeedFromDraft(draft({ city: picked }), context)?.city).toEqual({ id: '5000', name: 'Tel Aviv' });
    const suggest = { status: 'suggest', picked: null, suggestions: [picked.picked] } as const;
    expect(importSeedFromDraft(draft({ city: suggest }), context)?.city).toBeNull();
    expect(importSeedFromDraft(draft({ city: { status: 'none', picked: null, suggestions: [] } }), context)?.city).toBeNull();
  });

  it('an unknown sub-category, or a world without the picker, leaves it empty', () => {
    expect(importSeedFromDraft(draft({ extraction: extraction({ subcategory: 'spaceships' }) }), context)?.worldSubcategoryId).toBeNull();
    expect(importSeedFromDraft(draft({ extraction: extraction({ worldSlug: 'rides', subcategory: 'books' }) }), context)?.worldSubcategoryId).toBeNull();
  });

  it('missing texts become empty strings, not null', () => {
    expect(importSeedFromDraft(draft({ extraction: extraction({ title: null, description: null }) }), context)).toMatchObject({ title: '', description: '' });
  });

  it('nothing to prefill: the manual route, a non-post, an unknown world, no extraction', () => {
    expect(importSeedFromDraft(manualImportDraft('rate_limited'), context)).toBeNull();
    expect(importSeedFromDraft(draft({ routing: 'manual' }), context)).toBeNull();
    expect(importSeedFromDraft(draft({ extraction: extraction({ isPost: false }) }), context)).toBeNull();
    expect(importSeedFromDraft(draft({ extraction: extraction({ worldSlug: 'moon' }) }), context)).toBeNull();
    expect(importSeedFromDraft(draft({ extraction: extraction({ worldSlug: null }) }), context)).toBeNull();
    expect(importSeedFromDraft(draft({ extraction: null }), context)).toBeNull();
  });
});
