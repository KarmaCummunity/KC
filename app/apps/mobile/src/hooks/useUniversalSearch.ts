// FR-FEED-017+ — universal search with offline cache + stale-while-revalidate.
// Results persist via queryPersistKeys (`universalSearch`); UI shows cached
// payload immediately and refetches in the background.

import { useQuery } from '@tanstack/react-query';
import type { SearchFilters, SearchResultType } from '@kc/domain';
import { getUniversalSearchUseCase } from '../services/searchComposition';
import { hasUniversalSearchResults } from '../lib/universalSearchResults';

export const UNIVERSAL_SEARCH_QUERY_ROOT = 'universalSearch' as const;
export { hasUniversalSearchResults } from '../lib/universalSearchResults';

export interface UniversalSearchLimits {
  posts: number;
  users: number;
  links: number;
}

interface UseUniversalSearchInput {
  debouncedQuery: string;
  filters: SearchFilters;
  viewerId: string | null;
  expandedSection: SearchResultType | null;
  previewLimit: number;
  fullLimit: number;
  enabled: boolean;
}

function buildLimits(
  expandedSection: SearchResultType | null,
  previewLimit: number,
  fullLimit: number,
): UniversalSearchLimits {
  return {
    posts: expandedSection === 'post' ? fullLimit : previewLimit,
    users: expandedSection === 'user' ? fullLimit : previewLimit,
    links: expandedSection === 'link' ? fullLimit : previewLimit,
  };
}

export function useUniversalSearch(input: UseUniversalSearchInput) {
  const {
    debouncedQuery,
    filters,
    viewerId,
    expandedSection,
    previewLimit,
    fullLimit,
    enabled,
  } = input;

  const limits = buildLimits(expandedSection, previewLimit, fullLimit);

  const query = useQuery({
    queryKey: [UNIVERSAL_SEARCH_QUERY_ROOT, debouncedQuery, filters, expandedSection],
    queryFn: () =>
      getUniversalSearchUseCase().execute({
        query: debouncedQuery,
        filters,
        viewerId,
        limits,
      }),
    enabled,
    staleTime: 60_000,
    // Keep the previous result set visible while query/filters change.
    placeholderData: (previous) => previous,
  });

  const results = query.data;
  const hasResults = hasUniversalSearchResults(results);
  const showFullLoading = enabled && !results && query.isPending;
  const isBackgroundRefreshing = enabled && Boolean(results) && query.isFetching;

  return {
    query,
    results,
    hasResults,
    showFullLoading,
    isBackgroundRefreshing,
  };
}
