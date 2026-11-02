// Mapped to spec: FR-FEED-020 AC2 — a giving world's own feed of open offers and requests,
// with search within the world and the world's refinements (subcategory, distance).
// Pure rules of the world feed; the screen state lives in `useWorldFeed`.
import type { MarketplaceBrowseRow } from '@kc/domain';
import type { CreateDirection } from './unifiedCreate/createCategories';

/** Direction filter of a world feed: both directions, or only offers / requests. */
export type WorldFeedDirection = 'all' | CreateDirection;

/** Fewer characters than this browse instead of searching (one hybrid search per query). */
export const WORLD_FEED_MIN_QUERY = 2;

/** The `browse_listings` direction argument: null asks for both directions. */
export function browseDirection(direction: WorldFeedDirection): CreateDirection | null {
  return direction === 'all' ? null : direction;
}

/**
 * Search results cover both directions (`marketplace_search` has no direction argument), so
 * the chosen direction is applied to the loaded rows.
 */
export function filterRowsByDirection(
  rows: readonly MarketplaceBrowseRow[],
  direction: WorldFeedDirection,
): MarketplaceBrowseRow[] {
  if (direction === 'all') return [...rows];
  return rows.filter((row) => row.direction === direction);
}

/** Whether `query` is long enough to search instead of browsing. */
export function isWorldFeedSearch(query: string): boolean {
  return query.trim().length >= WORLD_FEED_MIN_QUERY;
}
