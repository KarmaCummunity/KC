// FR-FEED-020 AC2 — the world feed's pure rules: the direction filter maps onto the browse
// RPC, is applied to search results, and short queries browse instead of searching.
import { describe, expect, it } from 'vitest';
import type { MarketplaceBrowseRow } from '@kc/domain';
import {
  WORLD_FEED_MIN_QUERY,
  browseDirection,
  filterRowsByDirection,
  isWorldFeedSearch,
} from '../worldFeed';

const row = (listingId: string, direction: 'give' | 'request') =>
  ({ listingId, direction }) as unknown as MarketplaceBrowseRow;

const ROWS = [row('l1', 'give'), row('l2', 'request'), row('l3', 'give')];

describe('world feed rules', () => {
  it('asks the browse RPC for both directions on "all", else for the chosen one', () => {
    expect(browseDirection('all')).toBeNull();
    expect(browseDirection('give')).toBe('give');
    expect(browseDirection('request')).toBe('request');
  });

  it('keeps only the chosen direction of the loaded search results, in order', () => {
    expect(filterRowsByDirection(ROWS, 'give').map((r) => r.listingId)).toEqual(['l1', 'l3']);
    expect(filterRowsByDirection(ROWS, 'request').map((r) => r.listingId)).toEqual(['l2']);
  });

  it('keeps every row on "all" without handing back the same array', () => {
    const all = filterRowsByDirection(ROWS, 'all');
    expect(all).toEqual(ROWS);
    expect(all).not.toBe(ROWS);
  });

  it('searches from the minimum query length, ignoring surrounding spaces', () => {
    expect(WORLD_FEED_MIN_QUERY).toBe(2);
    expect(isWorldFeedSearch('')).toBe(false);
    expect(isWorldFeedSearch(' a ')).toBe(false);
    expect(isWorldFeedSearch('ab')).toBe(true);
    expect(isWorldFeedSearch('  ספה ')).toBe(true);
  });
});
