// FR-FEED-020 AC1 — a feed mirror of a rides, food, housing or time listing shows its giving
// world on the card (chip + icon); ordinary posts and items mirrors keep their subcategory.
import { describe, expect, it } from 'vitest';
import { feedCardCategory, worldChipKey } from '../feedCardCategory';
// eslint-disable-next-line no-restricted-imports -- test asserts every chip key exists in the Hebrew bundle
import he from '../../i18n/locales/he';
// eslint-disable-next-line no-restricted-imports -- test asserts every chip key exists in the English bundle
import en from '../../i18n/locales/en';

function resolveKey(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
}

describe('feedCardCategory', () => {
  it.each([
    ['rides', 'post.unifiedCreate.categories.rides', 'car-outline'],
    ['food', 'post.unifiedCreate.categories.food', 'restaurant-outline'],
    ['housing', 'post.unifiedCreate.categories.housing', 'home-outline'],
    ['time', 'post.unifiedCreate.categories.time', 'time-outline'],
    ['animals', 'post.unifiedCreate.categories.animals', 'paw-outline'],
    ['knowledge', 'post.unifiedCreate.categories.knowledge', 'school-outline'],
  ] as const)('a %s mirror shows its world chip and icon', (world, chipKey, icon) => {
    const card = feedCardCategory({ category: 'Other', type: 'Give', listingWorldSlug: world });
    expect(card).toEqual({ chipKey, icon });
  });

  it('shows the world for a request mirror too, not the request icon', () => {
    expect(feedCardCategory({ category: 'Other', type: 'Request', listingWorldSlug: 'rides' })).toEqual({
      chipKey: 'post.unifiedCreate.categories.rides',
      icon: 'car-outline',
    });
  });

  it('keeps the item subcategory on an items mirror', () => {
    expect(feedCardCategory({ category: 'Books', type: 'Give', listingWorldSlug: 'items' })).toEqual({
      chipKey: 'post.category.Books',
      icon: 'book-outline',
    });
  });

  it('keeps the item subcategory on an ordinary post', () => {
    expect(feedCardCategory({ category: 'Furniture', type: 'Request', listingWorldSlug: null })).toEqual({
      chipKey: 'post.category.Furniture',
      icon: 'bed-outline',
    });
  });

  it('falls back to the direction icon for a category without one', () => {
    expect(feedCardCategory({ category: 'Other', type: 'Give', listingWorldSlug: null }).icon).toBe('gift-outline');
    expect(feedCardCategory({ category: 'Other', type: 'Request', listingWorldSlug: null }).icon).toBe('hand-left-outline');
  });

  it('treats a manual share from a world outside the create form like an ordinary post', () => {
    expect(feedCardCategory({ category: 'Other', type: 'Give', listingWorldSlug: 'money' })).toEqual({
      chipKey: 'post.category.Other',
      icon: 'gift-outline',
    });
  });

  it.each(['rides', 'food', 'housing', 'time', 'animals', 'knowledge', null] as const)(
    'the chip key of a %s card resolves in Hebrew and English',
    (world) => {
      const { chipKey } = feedCardCategory({ category: 'Other', type: 'Give', listingWorldSlug: world });
      expect(typeof resolveKey(he, chipKey)).toBe('string');
      expect(typeof resolveKey(en, chipKey)).toBe('string');
    },
  );
});

// #1412 — a listing card names its world as the feed card does.
describe('worldChipKey', () => {
  it('uses the create category label for a create-form world, as the feed chip does', () => {
    expect(worldChipKey('rides')).toBe(feedCardCategory({ category: 'Other', type: 'Give', listingWorldSlug: 'rides' }).chipKey);
    expect(worldChipKey('items')).toBe('post.unifiedCreate.categories.items');
    expect(worldChipKey('knowledge')).toBe('post.unifiedCreate.categories.knowledge');
    expect(worldChipKey('animals')).toBe('post.unifiedCreate.categories.animals');
  });

  it.each(['money'])('keeps the marketplace name of the %s world, in Hebrew and English', (world) => {
    const key = worldChipKey(world);
    expect(key).toBe(`marketplace.world.${world}`);
    expect(typeof resolveKey(he, key)).toBe('string');
    expect(typeof resolveKey(en, key)).toBe('string');
  });
});
