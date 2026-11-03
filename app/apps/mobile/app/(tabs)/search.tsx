// Search tab — FR-FEED-017+ universal discovery + smart search.
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { useTheme, Text } from '@kc/ui';
import type { SearchResultType, SearchSortBy } from '@kc/domain';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../src/store/authStore';
import { useSearchStore } from '../../src/store/searchStore';
import { getUniversalSearchUseCase } from '../../src/services/searchComposition';
import { SearchFilterSheet } from '../../src/components/SearchFilterSheet';
import { TopBar } from '../../src/components/TopBar';
import { Screen } from '../../src/components/ui/Screen';
import { MotionEntry, ENTRY_DELAY } from '../../src/components/ui/MotionEntry';
import { useSearchScreenAside } from '../../src/components/aside/useSearchScreenAside';
import { useDebouncedSearchInput } from '../../src/hooks/useDebouncedSearchInput';
import { useSearchScreenStyles } from '../../src/screens/tabs/search.styles';
import { SearchSuggestedQueries } from '../../src/components/search/SearchSuggestedQueries';
import { SearchRecentSection } from '../../src/components/search/SearchRecentSection';
import { SearchResultSections } from '../../src/components/search/SearchResultSections';
import { FilterSearchBar } from '../../src/components/filterKit/FilterSearchBar';
import { FilterButton } from '../../src/components/filterKit/FilterButton';
import { FilterChipRow } from '../../src/components/filterKit/FilterChipRow';
import { Chip } from '../../src/components/ui/Chip';
import { PrimaryButton } from '../../src/components/ui/Buttons';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

// ── Constants ─────────────────────────────────
const DEBOUNCE_MS = 300; // debounce delay for search input
const PREVIEW_LIMIT = 5; // results per section before "Show all"
const FULL_LIMIT = 50;   // results per section after "Show all"

export default function SearchScreen() {
  const styles = useSearchScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const viewerId = session?.userId ?? null;

  // ── Search input with debounce ──────────────
  const { inputText, setInputText, debouncedQuery, setDebouncedQuery, handleTextChange } =
    useDebouncedSearchInput(DEBOUNCE_MS);

  // ── Store (filters, recent searches) ────────
  const store = useSearchStore(useShallow((s) => ({
    recentSearches: s.recentSearches,
    addRecentSearch: s.addRecentSearch,
    clearRecentSearches: s.clearRecentSearches,
    setResultType: s.setResultType,
    setSortBy: s.setSortBy,
  })));
  const filters = useSearchStore(useShallow((s) => ({
    resultType: s.resultType,
    postType: s.postType,
    category: s.category,
    donationCategory: s.donationCategory,
    city: s.city,
    radiusKm: s.radiusKm,
    sortBy: s.sortBy,
    minFollowers: s.minFollowers,
  })));
  const filterCount = useSearchStore((s) => s.activeFilterCount());

  // ── Expanded section state ──────────────────
  // When a user taps "Show all" on a section, we expand it to FULL_LIMIT.
  const [expandedSection, setExpandedSection] = useState<SearchResultType | null>(null);

  // ── Filter sheet visibility ─────────────────
  const [filterVisible, setFilterVisible] = useState(false);

  // ── Derived state ───────────────────────────
  const isSearchMode = debouncedQuery.length >= 2;
  const isSingleCharTyped = inputText.length > 0 && inputText.trim().length < 2;

  // ── Data query ──────────────────────────────
  // Fires on mount (explore mode) AND on every debounced query change.
  const query = useQuery({
    queryKey: ['universalSearch', debouncedQuery, filters, expandedSection],
    queryFn: () =>
      getUniversalSearchUseCase().execute({
        query: debouncedQuery,
        filters,
        viewerId,
        limits: { posts: expandedSection === 'post' ? FULL_LIMIT : PREVIEW_LIMIT, users: expandedSection === 'user' ? FULL_LIMIT : PREVIEW_LIMIT, links: expandedSection === 'link' ? FULL_LIMIT : PREVIEW_LIMIT },
      }),
    // Always enabled — empty query triggers explore mode
    enabled: !isSingleCharTyped,
    staleTime: 60_000, // PERF-3: search results — fresh enough for explore; realtime fills gaps
  });

  const results = query.data;
  const hasResults = Boolean(
    results && (results.posts.length || results.users.length || results.links.length || results.orgs.length || results.hashtags.length),
  );

  // ── Handlers ────────────────────────────────

  /** Tapping a recent search fills the input and fires the search. */
  const handleRecentTap = useCallback(
    (q: string) => {
      setInputText(q);
      setDebouncedQuery(q);
    },
    [setInputText, setDebouncedQuery],
  );

  // Desktop (>=1024) aside — recent searches (FR-RESP-003).
  useSearchScreenAside(handleRecentTap);

  /** Submitting search saves to recent searches. */
  const handleSubmit = () => {
    const q = inputText.trim();
    if (q.length >= 2) {
      store.addRecentSearch(q);
      setDebouncedQuery(q);
    }
  };

  /** Clears the search input and resets to explore mode. */
  const handleClear = () => {
    setInputText('');
    setDebouncedQuery('');
    setExpandedSection(null);
  };

  // ── Render ──────────────────────────────────

  return (
    <Screen blobs="content" testID="search-screen">
      {/* ── Header ──────────────────────────── */}
      <TopBar />

      {/* ── Search bar + filter button ──────── */}
      <MotionEntry variant="hero" delay={ENTRY_DELAY.hero} style={styles.searchRow}>
        <FilterSearchBar
          style={styles.searchBarWrap}
          inputRowStyle={styles.searchBarRow}
          value={inputText}
          onChangeText={handleTextChange}
          onSubmitEditing={handleSubmit}
          placeholder={t('search.placeholder')}
          onClear={handleClear}
          testID="search-input"
        />

        {/* Filter button with active count badge */}
        <FilterButton
          activeCount={filterCount}
          onPress={() => setFilterVisible(true)}
          variant="boxed"
          testID="search-filter-button"
        />
      </MotionEntry>

      {/* ── Category type chips ─────────────── */}
      <FilterChipRow<SearchResultType>
        scrollable
        showAllChip
        allLabel={t('search.all')}
        options={[
          { value: 'post', label: t('search.posts') },
          { value: 'user', label: t('search.people') },
          { value: 'link', label: t('search.links') },
          { value: 'org', label: t('search.orgs') },
          { value: 'hashtag', label: t('search.hashtags') },
        ]}
        value={filters.resultType}
        onChange={(type) => {
          store.setResultType(type);
          setExpandedSection(null);
        }}
        style={styles.chipContainer}
        contentContainerStyle={styles.chipRow}
      >
        {/* Sort chips — only visible when actively searching */}
        {isSearchMode && (
          <>
            <View style={styles.chipDivider} />
            {(['relevance', 'newest', 'followers'] as SearchSortBy[]).map((s) => (
              <Chip
                key={s}
                size="sm"
                label={s === 'relevance' ? t('search.sortRelevance') : s === 'newest' ? t('search.sortNewest') : t('search.sortFollowers')}
                selected={filters.sortBy === s}
                onPress={() => store.setSortBy(s)}
              />
            ))}
          </>
        )}
      </FilterChipRow>

      {/* ── Content area ────────────────────── */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        keyboardShouldPersistTaps="handled"
      >
        {/* Min chars message (1 char typed) */}
        {isSingleCharTyped && (
          <View style={styles.emptyState}>
            <Ionicons
              name="text-outline"
              size={40} // brand-guard-allow: empty-state hero glyph
              color={colors.textDisabled}
            />
            <Text style={styles.emptySubtitle}>{t('search.minChars')}</Text>
          </View>
        )}

        {/* Loading spinner */}
        {!isSingleCharTyped && query.isLoading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('search.loading')}</Text>
          </View>
        )}

        {/* Error state */}
        {!isSingleCharTyped && query.isError && (
          <View style={styles.emptyState}>
            <Ionicons
              name="alert-circle-outline"
              size={48} // brand-guard-allow: empty-state hero glyph
              color={colors.textDisabled}
            />
            <Text style={styles.emptyTitle}>{t('general.errorTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('errorBoundary.body')}</Text>
            <PrimaryButton
              testID="search-load-error-retry"
              label={t('general.retry')}
              size="md"
              onPress={() => void query.refetch()}
            />
          </View>
        )}

        {/* No results (search mode only — explore always has content) */}
        {isSearchMode && !query.isLoading && results && !hasResults && (
          <View style={styles.emptyState}>
            <Ionicons
              name="search-outline"
              size={48} // brand-guard-allow: empty-state hero glyph
              color={colors.textDisabled}
            />
            <Text style={styles.emptyTitle}>{t('search.noResults')}</Text>
            <Text style={styles.emptySubtitle}>{t('search.noResultsDesc')}</Text>
          </View>
        )}

        {/* Recent searches (shown in explore mode, above the discovery feed) */}
        {!isSearchMode && !isSingleCharTyped && (
          <SearchSuggestedQueries
            queries={results?.suggestedQueries ?? []}
            onSelect={handleRecentTap}
          />
        )}

        {!isSearchMode && !isSingleCharTyped && (
          <SearchRecentSection
            queries={store.recentSearches}
            onSelect={handleRecentTap}
            onClear={() => store.clearRecentSearches()}
          />
        )}

        {/* ── Result sections ──────────────── */}
        {!isSingleCharTyped && results && hasResults && (
          <SearchResultSections
            results={results}
            expandedSection={expandedSection}
            onExpand={setExpandedSection}
            previewLimit={PREVIEW_LIMIT}
            showNationalLinksNote={Boolean(filters.city)}
            onHashtagTap={handleRecentTap}
          />
        )}
      </ScrollView>

      {/* ── Filter sheet (modal) ───────────── */}
      <SearchFilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />
    </Screen>
  );
}
