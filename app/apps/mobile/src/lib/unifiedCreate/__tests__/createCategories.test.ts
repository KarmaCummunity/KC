// FR-POST-001 AC6 / D100 — the create form offers one category per giving world, in a fixed
// order, each with an engine, an icon and a Hebrew label; one route serves every create button.
import { describe, expect, it } from 'vitest';
import {
  CREATE_CATEGORIES,
  CREATE_CATEGORY_IDS,
  DEFAULT_CREATE_CATEGORY,
  WORLDS_WITH_SUBCATEGORY_PICKER,
  createCategoryForPath,
  createRouteFor,
  findCreateCategory,
  isCreateCategoryId,
  isCreateDirection,
  resolveCreateCategory,
} from '../createCategories';
// eslint-disable-next-line no-restricted-imports -- test asserts every category label key exists in the Hebrew bundle
import he from '../../../i18n/locales/he';

function resolveKey(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
}

describe('unified create — category config', () => {
  it('offers one category per giving world, in the hub order, without duplicates', () => {
    const ids = CREATE_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      'items', 'food', 'rides', 'time', 'money', 'housing', 'knowledge',
      'medical', 'animals', 'democracy', 'employment', 'challenges',
    ]);
    expect(ids).toEqual([...CREATE_CATEGORY_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no "general", domain or experiences category any more', () => {
    for (const removed of ['general', 'environment', 'elderly', 'sport', 'experiences']) {
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
    expect(label('medical')).toBe('רפואה');
    expect(label('democracy')).toBe('דמוקרטיה');
  });

  it('items keep the post engine; worlds with a feed write a listing; the rest add a link', () => {
    const items = findCreateCategory('items');
    expect(items.engine).toBe('post');
    expect(items.worldSlug).toBeNull();
    expect(items.linkCategory).toBeNull();
    for (const id of ['rides', 'food', 'housing', 'time']) {
      const c = findCreateCategory(id);
      expect(c.engine).toBe('listing');
      expect(c.worldSlug).toBe(id);
      expect(c.linkCategory).toBeNull();
    }
    const links = Object.fromEntries(
      CREATE_CATEGORIES.filter((c) => c.engine === 'link').map((c) => [c.id, c.linkCategory]),
    );
    expect(links).toEqual({
      money: 'money', knowledge: 'knowledge', medical: 'medical', animals: 'animals',
      democracy: 'democracy', employment: 'employment', challenges: 'challenges',
    });
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
    expect(createRouteFor('experiences')).toBe('/(tabs)/create');
    expect(createRouteFor('rides')).toBe('/(tabs)/create?category=rides');
    expect(createRouteFor('items')).toBe('/(tabs)/create?category=items');
  });

  it('presets the direction with a category (FR-FEED-020 AC2), never without one', () => {
    expect(createRouteFor('food', 'request')).toBe('/(tabs)/create?category=food&direction=request');
    expect(createRouteFor('housing', 'give')).toBe('/(tabs)/create?category=housing&direction=give');
    expect(createRouteFor('rides', null)).toBe('/(tabs)/create?category=rides');
    expect(createRouteFor('experiences', 'give')).toBe('/(tabs)/create');
    expect(createRouteFor(null, 'request')).toBe('/(tabs)/create');
  });

  it('recognises exactly the two create directions', () => {
    expect(isCreateDirection('give')).toBe(true);
    expect(isCreateDirection('request')).toBe(true);
    for (const bad of ['Give', 'offer', '', null, undefined, 1]) expect(isCreateDirection(bad)).toBe(false);
  });

  it('maps a donations screen path to its create category, for the "+" button', () => {
    expect(createCategoryForPath('/donations/food')).toBe('food');
    expect(createCategoryForPath('/donations/rides/series')).toBe('rides');
    expect(createCategoryForPath('/donations/items')).toBe('items');
    expect(createCategoryForPath('/donations/category/medical')).toBe('medical');
    expect(createCategoryForPath('/donations/money')).toBe('money');
  });

  it('gives no category outside a giving world', () => {
    for (const path of ['/', '/search', '/profile', '/donations', '/donations/marketplace/abc', '/donations/category/bogus', null, undefined]) {
      expect(createCategoryForPath(path)).toBeNull();
    }
  });
});

describe('resolveCreateCategory — knowledge opens as a listing form once launched (#1630)', () => {
  const knowledge = findCreateCategory('knowledge');

  it('keeps the community-link form while the knowledge world is a portal', () => {
    for (const remote of [undefined, {}, { world_knowledge_enabled: false }]) {
      expect(resolveCreateCategory(knowledge, remote)).toBe(knowledge);
    }
    expect(knowledge.engine).toBe('link');
  });

  it('writes a marketplace listing to the knowledge world once it is active', () => {
    const resolved = resolveCreateCategory(knowledge, { world_knowledge_enabled: true });
    expect(resolved).toMatchObject({ id: 'knowledge', engine: 'listing', worldSlug: 'knowledge', linkCategory: null });
  });

  it('leaves every other category untouched', () => {
    for (const category of CREATE_CATEGORIES.filter((c) => c.id !== 'knowledge')) {
      expect(resolveCreateCategory(category, { world_knowledge_enabled: true })).toBe(category);
    }
  });
});

describe('resolveCreateCategory — animals opens as a listing form once launched (#1625)', () => {
  const animals = findCreateCategory('animals');

  it('keeps the community-link form while the animals world is a portal', () => {
    for (const remote of [undefined, {}, { world_animals_enabled: false }]) {
      expect(resolveCreateCategory(animals, remote)).toBe(animals);
    }
    expect(animals.engine).toBe('link');
  });

  it('writes a marketplace listing to the animals world once it is active', () => {
    expect(resolveCreateCategory(animals, { world_animals_enabled: true })).toMatchObject({
      id: 'animals', engine: 'listing', worldSlug: 'animals', linkCategory: null,
    });
  });

  it('is not switched on by the knowledge flag, and medical stays a portal', () => {
    expect(resolveCreateCategory(animals, { world_knowledge_enabled: true })).toBe(animals);
    const medical = findCreateCategory('medical');
    expect(resolveCreateCategory(medical, { world_medical_enabled: true, world_animals_enabled: true })).toBe(medical);
  });
});
