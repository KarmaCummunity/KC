// FR-POST-001 AC6 — the create form offers exactly five categories, in a fixed order, each
// with an engine, an icon and a Hebrew label; one route serves every create button.
import { describe, expect, it } from 'vitest';
import {
  CREATE_CATEGORIES,
  CREATE_CATEGORY_IDS,
  DEFAULT_CREATE_CATEGORY,
  WORLDS_WITH_SUBCATEGORY_PICKER,
  createRouteFor,
  findCreateCategory,
  isCreateCategoryId,
  isCreateDirection,
} from '../createCategories';
// eslint-disable-next-line no-restricted-imports -- test asserts every category label key exists in the Hebrew bundle
import he from '../../../i18n/locales/he';

function resolveKey(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
}

describe('unified create — category config', () => {
  it('offers items, rides, food, housing, time — in that order, without duplicates', () => {
    const ids = CREATE_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(['items', 'rides', 'food', 'housing', 'time']);
    expect(ids).toEqual([...CREATE_CATEGORY_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no "general" or marketplace-only category any more', () => {
    for (const removed of ['general', 'money', 'knowledge', 'medical', 'animals', 'environment']) {
      expect(isCreateCategoryId(removed)).toBe(false);
    }
  });

  it.each(CREATE_CATEGORIES.map((c) => [c.id, c] as const))('%s has a Hebrew label and an icon', (_id, c) => {
    expect(typeof resolveKey(he, c.labelKey)).toBe('string');
    expect(c.icon).toMatch(/-outline$/);
  });

  it('uses the user-facing Hebrew names', () => {
    const label = (id: string) => resolveKey(he, findCreateCategory(id).labelKey);
    expect(label('items')).toBe('חפצים');
    expect(label('rides')).toBe('טרמפים');
    expect(label('food')).toBe('אוכל');
    expect(label('housing')).toBe('דיור');
    expect(label('time')).toBe('זמן');
  });

  it('items keep the post engine; every other category writes a listing of its own world', () => {
    const items = findCreateCategory('items');
    expect(items.engine).toBe('post');
    expect(items.worldSlug).toBeNull();
    for (const c of CREATE_CATEGORIES.filter((x) => x.id !== 'items')) {
      expect(c.engine).toBe('listing');
      expect(c.worldSlug).toBe(c.id);
    }
  });

  it('food is the only listing category with a world subcategory picker (KC#1296)', () => {
    const listingIds = CREATE_CATEGORIES.filter((c) => c.engine === 'listing').map((c) => c.id);
    expect(listingIds.filter((id) => WORLDS_WITH_SUBCATEGORY_PICKER.includes(id))).toEqual(['food']);
  });

  it('unknown, missing or removed ids fall back to the default category (items)', () => {
    expect(DEFAULT_CREATE_CATEGORY).toBe('items');
    expect(findCreateCategory('nope').id).toBe('items');
    expect(findCreateCategory(undefined).id).toBe('items');
    expect(findCreateCategory(null).id).toBe('items');
    expect(findCreateCategory('general').id).toBe('items');
  });

  it('isCreateCategoryId accepts only the configured ids', () => {
    expect(isCreateCategoryId('rides')).toBe(true);
    expect(isCreateCategoryId('')).toBe(false);
    expect(isCreateCategoryId(42)).toBe(false);
    expect(isCreateCategoryId(undefined)).toBe(false);
  });

  it('every entry point uses one route, preselecting a known category only', () => {
    expect(createRouteFor()).toBe('/(tabs)/create');
    expect(createRouteFor(null)).toBe('/(tabs)/create');
    expect(createRouteFor('knowledge')).toBe('/(tabs)/create');
    expect(createRouteFor('rides')).toBe('/(tabs)/create?category=rides');
    expect(createRouteFor('items')).toBe('/(tabs)/create?category=items');
  });

  it('presets the direction with a category (FR-FEED-020 AC2), never without one', () => {
    expect(createRouteFor('food', 'request')).toBe('/(tabs)/create?category=food&direction=request');
    expect(createRouteFor('housing', 'give')).toBe('/(tabs)/create?category=housing&direction=give');
    expect(createRouteFor('rides', null)).toBe('/(tabs)/create?category=rides');
    expect(createRouteFor('knowledge', 'give')).toBe('/(tabs)/create');
    expect(createRouteFor(null, 'request')).toBe('/(tabs)/create');
  });

  it('recognises exactly the two create directions', () => {
    expect(isCreateDirection('give')).toBe(true);
    expect(isCreateDirection('request')).toBe(true);
    for (const bad of ['Give', 'offer', '', null, undefined, 1]) expect(isCreateDirection(bad)).toBe(false);
  });
});
