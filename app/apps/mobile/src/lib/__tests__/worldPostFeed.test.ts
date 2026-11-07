// FR-FEED-020 AC2 — a world's feed filter: the main feed's filter with the world locked.
import { describe, expect, it } from 'vitest';
import {
  countWorldPostFilters,
  isWorldPostSearch,
  worldFeedFilter,
  worldPostFilterDefaults,
} from '../worldPostFeed';

describe('worldPostFeed', () => {
  it('defaults to the open posts of the world, newest first, with nothing counted', () => {
    const v = worldPostFilterDefaults('food');
    expect(v).toMatchObject({ worlds: ['food'], statusFilter: 'open', sortOrder: 'newest', searchQuery: '' });
    expect(countWorldPostFilters(v)).toBe(0);
  });

  it('counts every refinement beyond the world', () => {
    const v = { ...worldPostFilterDefaults('food'), type: 'Give' as const, sortOrder: 'distance' as const, searchQuery: 'חלה' };
    expect(countWorldPostFilters(v)).toBe(3);
  });

  it('locks the world in the query whatever the value holds', () => {
    const v = { ...worldPostFilterDefaults('food'), worlds: ['items'] };
    expect(worldFeedFilter('food', v).worlds).toEqual(['food']);
  });

  it('searches from two letters, trimmed', () => {
    const one = { ...worldPostFilterDefaults('food'), searchQuery: ' ח ' };
    const two = { ...worldPostFilterDefaults('food'), searchQuery: ' חל ' };
    expect(worldFeedFilter('food', one).searchQuery).toBeUndefined();
    expect(isWorldPostSearch(one)).toBe(false);
    expect(countWorldPostFilters(one)).toBe(0);
    expect(worldFeedFilter('food', two).searchQuery).toBe('חל');
    expect(isWorldPostSearch(two)).toBe(true);
  });
});
