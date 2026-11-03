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
} from '../unifiedCreateState';

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
    expect(DEFAULT_CREATE_PREFERENCES).toEqual({ categoryId: 'items', directions: {} });
    expect(parseCreatePreferences(null)).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences(undefined)).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(parseCreatePreferences('')).toEqual(DEFAULT_CREATE_PREFERENCES);
    expect(directionFor(DEFAULT_CREATE_PREFERENCES, 'rides')).toBe('give');
  });

  it('round-trips the last category and one direction per category', () => {
    const prefs = { categoryId: 'rides', directions: { rides: 'request', items: 'give', food: 'request' } } as const;
    expect(parseCreatePreferences(serializeCreatePreferences(prefs))).toEqual(prefs);
  });

  it('remembers directions independently per category', () => {
    let prefs = withCategory(DEFAULT_CREATE_PREFERENCES, 'rides', 'request');
    prefs = withCategory(prefs, 'items', 'give');
    prefs = withCategory(prefs, 'rides');
    expect(prefs.categoryId).toBe('rides');
    expect(directionFor(prefs, 'rides')).toBe('request');
    expect(directionFor(prefs, 'items')).toBe('give');
    expect(directionFor(prefs, 'food')).toBe('give');
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
    });
  });

  it('drops unknown categories and bad directions field by field', () => {
    expect(parseCreatePreferences('{"categoryId":"general","direction":"request"}')).toEqual({
      categoryId: 'items',
      directions: {},
    });
    expect(
      parseCreatePreferences('{"categoryId":"food","directions":{"food":"sideways","rides":"request","gone":"give"}}'),
    ).toEqual({ categoryId: 'food', directions: { rides: 'request' } });
  });
});
