import { describe, expect, it } from 'vitest';
import {
  countMuteFilters,
  findCategoryMute,
  findWorldMute,
  groupMuteFilters,
  isKeywordMuted,
  isValidQuietTime,
  normalizeMuteKeyword,
  normalizeQuietTime,
  type MuteFilter,
} from '../feedMuteFilters';

const rows: MuteFilter[] = [
  { filterId: '1', filterKind: 'user', filterValue: 'u-1' },
  { filterId: '2', filterKind: 'keyword', filterValue: 'sofa' },
  { filterId: '3', filterKind: 'keyword', filterValue: 'Bike' },
  { filterId: '4', filterKind: 'category', filterValue: 'Books' },
  { filterId: '5', filterKind: 'world', filterValue: 'Toys' },
];

describe('normalizeMuteKeyword', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeMuteKeyword('  baby   stroller ')).toBe('baby stroller');
  });
  it('rejects too short or too long', () => {
    expect(normalizeMuteKeyword(' a ')).toBeNull();
    expect(normalizeMuteKeyword('')).toBeNull();
    expect(normalizeMuteKeyword('x'.repeat(121))).toBeNull();
    expect(normalizeMuteKeyword('x'.repeat(120))).toHaveLength(120);
  });
});

describe('groupMuteFilters', () => {
  it('splits into users, sorted keywords, and categories (category + world)', () => {
    const g = groupMuteFilters(rows);
    expect(g.users.map((r) => r.filterId)).toEqual(['1']);
    expect(g.keywords.map((r) => r.filterValue)).toEqual(['Bike', 'sofa']);
    expect(g.categories.map((r) => r.filterValue)).toEqual(['Books']);
    expect(g.worlds.map((r) => r.filterValue)).toEqual(['Toys']);
  });
});

describe('countMuteFilters', () => {
  it('counts every mute row', () => {
    expect(countMuteFilters(rows)).toBe(5);
    expect(countMuteFilters([])).toBe(0);
  });
});

describe('isKeywordMuted / findCategoryMute', () => {
  it('matches keywords case-insensitively', () => {
    expect(isKeywordMuted(rows, 'SOFA')).toBe(true);
    expect(isKeywordMuted(rows, 'chair')).toBe(false);
  });
  it('finds category and world mutes separately', () => {
    expect(findCategoryMute(rows, 'Books')?.filterId).toBe('4');
    expect(findCategoryMute(rows, 'Toys')).toBeUndefined();
    expect(findWorldMute(rows, 'Toys')?.filterId).toBe('5');
    expect(findWorldMute(rows, 'food')).toBeUndefined();
  });
});

describe('quiet hours time', () => {
  it('validates HH:MM', () => {
    expect(isValidQuietTime('22:00')).toBe(true);
    expect(isValidQuietTime('07:30')).toBe(true);
    expect(isValidQuietTime('7:30')).toBe(false);
    expect(isValidQuietTime('24:00')).toBe(false);
  });
  it('normalizes loose input', () => {
    expect(normalizeQuietTime('7')).toBe('07:00');
    expect(normalizeQuietTime('7:5')).toBe('07:05');
    expect(normalizeQuietTime('0730')).toBe('07:30');
    expect(normalizeQuietTime('2215')).toBe('22:15');
    expect(normalizeQuietTime('25:00')).toBeNull();
    expect(normalizeQuietTime('7:60')).toBeNull();
    expect(normalizeQuietTime('abc')).toBeNull();
  });
});
