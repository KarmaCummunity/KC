import { describe, expect, it } from 'vitest';
import {
  countMuteFilters,
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
  { filterId: '5', filterKind: 'world', filterValue: 'Toys' },
];

describe('normalizeMuteKeyword', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeMuteKeyword('  baby   stroller ')).toBe('baby stroller');
  });
  it('rejects too short or too long', () => {
    expect(normalizeMuteKeyword(' a ')).toBeNull();
    expect(normalizeMuteKeyword('')).toBeNull();
    expect(normalizeMuteKeyword('x'.repeat(61))).toBeNull();
    expect(normalizeMuteKeyword('x'.repeat(60))).toHaveLength(60);
  });
});

describe('groupMuteFilters', () => {
  it('splits into users, sorted keywords and worlds', () => {
    const g = groupMuteFilters(rows);
    expect(g.users.map((r) => r.filterId)).toEqual(['1']);
    expect(g.keywords.map((r) => r.filterValue)).toEqual(['Bike', 'sofa']);
    expect(g.worlds.map((r) => r.filterValue)).toEqual(['Toys']);
  });
});

describe('countMuteFilters', () => {
  it('counts every mute row', () => {
    expect(countMuteFilters(rows)).toBe(4);
    expect(countMuteFilters([])).toBe(0);
  });
});

describe('isKeywordMuted / findWorldMute', () => {
  it('matches keywords case-insensitively', () => {
    expect(isKeywordMuted(rows, 'SOFA')).toBe(true);
    expect(isKeywordMuted(rows, 'chair')).toBe(false);
  });
  it('finds a world mute by slug', () => {
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
