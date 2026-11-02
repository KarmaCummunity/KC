// Mapped to spec: FR-FEED-020 AC2 — the state of one giving world's feed: search within the
// world, the direction filter, and the world's subcategory + distance refinements.
// Browsing (keyset pages of `browse_listings`, anchored on the viewer's home) and searching
// (`marketplace_search`, scoped to the world) are two infinite queries; the screen reads
// whichever is active.
import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_BROWSE_RADIUS_KM } from '../components/marketplace/BrowseRefineChips';
import {
  browseDirection,
  filterRowsByDirection,
  isWorldFeedSearch,
  type WorldFeedDirection,
} from '../lib/worldFeed';
import { flattenPages, useMarketplaceBrowse, useMarketplaceSearchResults } from './useMarketplaceBrowse';
import { useDebouncedValue } from './useDebouncedValue';
import { usePrefetchNextPage } from './usePrefetchNextPage';

/** Typing pause before a search runs, so a query is not sent per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

export function useWorldFeed(worldSlug: string) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<WorldFeedDirection>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_BROWSE_RADIUS_KM);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searching = isWorldFeedSearch(debouncedQuery);

  const browseFilters = useMemo(
    () => ({ worldSlug, direction: browseDirection(direction), categoryId, radiusKm }),
    [worldSlug, direction, categoryId, radiusKm],
  );
  const browse = useMarketplaceBrowse(browseFilters);
  // The search hook stays disabled below the minimum query length.
  const search = useMarketplaceSearchResults(searching ? debouncedQuery : '', worldSlug);
  const active = searching ? search : browse;
  usePrefetchNextPage(active);

  const rows = useMemo(() => {
    const loaded = flattenPages(active.data);
    // Browse already filtered by direction on the server; search results need it here.
    return searching ? filterRowsByDirection(loaded, direction) : loaded;
  }, [active.data, searching, direction]);

  /** Anything narrowing the feed beyond "the whole world, default distance". */
  const refined =
    searching || direction !== 'all' || categoryId !== null || radiusKm !== DEFAULT_BROWSE_RADIUS_KM;

  const loadMore = useCallback(() => {
    if (active.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage();
  }, [active]);

  const clear = useCallback(() => {
    setQuery('');
    setDirection('all');
    setCategoryId(null);
    setRadiusKm(DEFAULT_BROWSE_RADIUS_KM);
  }, []);

  return {
    query,
    setQuery,
    /** The debounced query that results are for (empty-state copy). */
    searchedQuery: debouncedQuery.trim(),
    searching,
    direction,
    setDirection,
    categoryId,
    setCategoryId,
    radiusKm,
    setRadiusKm,
    rows,
    refined,
    isLoading: active.isLoading,
    isRefreshing: active.isRefetching && !active.isFetchingNextPage,
    refresh: () => void active.refetch(),
    loadMore,
    clear,
  };
}

export type WorldFeedState = ReturnType<typeof useWorldFeed>;
