// Mapped to spec: FR-FEED-020 AC2 — a giving world's feed is the main feed (FR-FEED-001) narrowed
// to that world: the same posts, the same card and the same filter sheet (FR-FEED-004), with the
// world locked. Its filter lives per world screen and is not persisted, so it never changes the
// main feed's saved filter (FR-FEED-005).
import type { PostFeedFilter } from '@kc/application';
import type { PostFilterValue } from '../components/PostFilterSheet';

/** Shortest search the feed runs (as on the main feed). */
const MIN_SEARCH_LENGTH = 2;

export function worldPostFilterDefaults(worldSlug: string): PostFilterValue {
  return {
    type: null,
    worlds: [worldSlug],
    subcategories: [],
    categories: [],
    itemConditions: [],
    locationFilter: null,
    statusFilter: 'open',
    sortOrder: 'newest',
    proximitySortCity: null,
    proximitySortCityName: null,
    followersOnly: false,
    searchQuery: '',
  };
}

/** The filter button's badge: every refinement beyond the world itself (main feed's rule). */
export function countWorldPostFilters(v: PostFilterValue): number {
  const active = [
    v.type !== null,
    (v.subcategories?.length ?? 0) > 0,
    (v.categories?.length ?? 0) > 0,
    v.itemConditions.length > 0,
    v.locationFilter !== null,
    v.statusFilter !== 'open',
    v.sortOrder !== 'newest',
    v.proximitySortCity !== null,
    v.followersOnly,
    v.searchQuery.trim().length >= MIN_SEARCH_LENGTH,
  ];
  return active.filter(Boolean).length;
}

/** The feed query's filter; the world is always the screen's own. */
export function worldFeedFilter(worldSlug: string, v: PostFilterValue): PostFeedFilter {
  const query = v.searchQuery.trim();
  return {
    type: v.type ?? undefined,
    worlds: [worldSlug],
    subcategories: v.subcategories,
    categories: v.categories,
    itemConditions: v.itemConditions,
    locationFilter: v.locationFilter ?? undefined,
    statusFilter: v.statusFilter,
    sortOrder: v.sortOrder,
    proximitySortCity: v.proximitySortCity ?? undefined,
    followersOnly: v.followersOnly,
    searchQuery: query.length >= MIN_SEARCH_LENGTH ? query : undefined,
  };
}

export function isWorldPostSearch(v: PostFilterValue): boolean {
  return v.searchQuery.trim().length >= MIN_SEARCH_LENGTH;
}
