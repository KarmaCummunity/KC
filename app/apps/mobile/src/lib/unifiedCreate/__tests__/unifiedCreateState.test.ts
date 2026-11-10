// FR-POST-001 AC1 / AC6 — direction ↔ post type, and the remembered category + direction
// that the form reopens on (parsed defensively from device storage).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREATE_PREFERENCES,
  directionFor,
  withCategory,
  directionToPostType,
  parseCreatePreferences,
  postTypeToDirection,
  serializeCreatePreferences,
  sortCreateCategoriesByUsage,
} from '../unifiedCreateState';
import { CREATE_CATEGORIES } from '../createCategories';

describe('unified create — direction mapping', () => {
  it('maps direction <-> post type', () => {
    expect(directionToPostType('give')).toBe('Give');
    expect(directionToPostType('request')).toBe('Request');
    expect(postTypeToDirection('Give')).toBe('give');
    expect(postTypeToDirection('Request')).toBe('request');
  });
});

describe('unified create — remembered preferences', () => {
  it('defaults to items + offer when nothing is stored', () => {
    expect(DEFAULT_CREATE_PREFERENCES).toEqual({ categoryId: 'items', directions: {}, usageCounts: {} });
    expect(parseCreatePreferences(null)).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences(undefined)).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences('')).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(directionFor(DEFAULT_CREATE_PREFERENCES, 'rides')).toBe('give');
  });

  it('round-trips the last category and one direction per category', () => {
    const prefs = {
      categoryId: 'rides',
      directions: { rides: 'request', items: 'give', food: 'request' },
      usageCounts: { rides: 3, food: 1 },
    } as const;
    expect(parseCreatePreferences(serializeCreatePreferences(prefs))).toEqual(prefs);
  });

  it('remembers directions independently per category', () => {
    let prefs = withCategory(DEFAULT_CREATE_PREFERENCES, 'rides', 'request', true);
    prefs = withCategory(prefs, 'items', 'give', true);
    prefs = withCategory(prefs, 'rides');
    expect(prefs.categoryId).toBe('rides');
    expect(directionFor(prefs, 'rides')).toBe('request');
    expect(directionFor(prefs, 'items')).toBe('give');
    expect(directionFor(prefs, 'food')).toBe('give');
    expect(prefs.usageCounts).toEqual({ rides: 1, items: 1 });
  });

  it('sorts picker categories by usage, then hub order', () => {
    const sorted = sortCreateCategoriesByUsage(CREATE_CATEGORIES, { rides: 4, food: 4, housing: 2 });
    expect(sorted.map((c) => c.id).slice(0, 4)).toEqual(['food', 'rides', 'housing', 'items']);
    expect(sorted.map((c) => c.id)).toHaveLength(CREATE_CATEGORIES.length);
  });

  it('survives corrupt or non-object JSON', () => {
    expect(parseCreatePreferences('{not json')).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences('null')).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences('"rides"')).toEqual(DEFAULT_CREATE_PREFERENCES);
  });

  it('migrates the first release format: its single direction now belongs to its category', () => {
    expect(parseCreatePreferences('{"categoryId":"time","direction":"request"}')).toEqual({
      categoryId: 'time',
      directions: { time: 'request' },
      usageCounts: {},
    });
  });

  it('drops unknown categories and bad directions field by field', () => {
    expect(parseCreatePreferences('{"categoryId":"general","direction":"request"}')).toEqual({
      categoryId: 'items',
      directions: {},
      usageCounts: {},
    });
    expect(
      parseCreatePreferences('{"categoryId":"food","directions":{"food":"sideways","rides":"request","gone":"give"}}'),
    ).toEqual({ categoryId: 'food', directions: { rides: 'request' }, usageCounts: {} });
  });
});
