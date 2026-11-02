// Search tab — FR-FEED-017+ universal discovery + smart search.
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { useTheme, Text, TextInput, iconSize } from '@kc/ui';
import { rtlTextAlignStart } from '../../src/lib/rtlLayout';
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
  const store = useSearchStore(
    useShallow((s) => ({
      recentSearches: s.recentSearches,
      addRecentSearch: s.addRecentSearch,
      clearRecentSearches: s.clearRecentSearches,
      setResultType: s.setResultType,
      setSortBy: s.setSortBy,
    })),
  );
  const filters = useSearchStore(
    useShallow((s) => ({
      resultType: s.resultType,
      postType: s.postType,
      category: s.category,
      donationCategory: s.donationCategory,
      city: s.city,
      radiusKm: s.radiusKm,
      sortBy: s.sortBy,
      minFollowers: s.minFollowers,
    })),
  );
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
        limits: {
          posts: expandedSection === 'post' ? FULL_LIMIT : PREVIEW_LIMIT,
          users: expandedSection === 'user' ? FULL_LIMIT : PREVIEW_LIMIT,
          links: expandedSection === 'link' ? FULL_LIMIT : PREVIEW_LIMIT,
        },
      }),
    // Always enabled — empty query triggers explore mode
    enabled: !isSingleCharTyped,
    staleTime: 60_000, // PERF-3: search results — fresh enough for explore; realtime fills gaps
  });

  const results = query.data;
  const hasResults =
    results
    && (results.posts.length > 0
      || results.users.length > 0
      || results.links.length > 0
      || results.orgs.length > 0
      || results.hashtags.length > 0);

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
        <View style={styles.searchInput}>
          <Ionicons name="search" size={iconSize.md} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput // brand-guard-allow: search bar is a non-form input
            style={styles.searchText}
            value={inputText}
            onChangeText={handleTextChange}
            onSubmitEditing={handleSubmit}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.textDisabled}
            textAlign={rtlTextAlignStart}
            returnKeyType="search"
            autoCorrect={false}
          />
          {inputText ? (
            <TouchableOpacity onPress={handleClear}>
              <Ionicons name="close-circle" size={iconSize.md} color={colors.textDisabled} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter button with active count badge */}
        <TouchableOpacity
          style={[styles.filterBtn, filterCount > 0 && styles.filterBtnActive]}
          onPress={() => setFilterVisible(true)}
        >
          <Ionicons
            name="options-outline"
            size={iconSize.lg}
            color={filterCount > 0 ? colors.textInverse : colors.textPrimary}
          />
          {filterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{filterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </MotionEntry>

      {/* ── Category type chips ─────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipContainer}
      >
        {([null, 'post', 'user', 'link', 'org', 'hashtag'] as (SearchResultType | null)[]).map((type) => {
          const labels: Record<string, string> = {
            '': t('search.all'),
            post: t('search.posts'),
            user: t('search.people'),
            link: t('search.links'),
            org: t('search.orgs'),
            hashtag: t('search.hashtags'),
          };
          const active = filters.resultType === type;
          return (
            <Pressable
              key={type ?? 'all'}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                store.setResultType(type);
                setExpandedSection(null);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {labels[type ?? '']}
              </Text>
            </Pressable>
          );
        })}

        {/* Sort chips — only visible when actively searching */}
        {isSearchMode && (
          <>
            <View style={styles.chipDivider} />
            {(['relevance', 'newest', 'followers'] as SearchSortBy[]).map((s) => {
              const labels: Record<string, string> = {
                relevance: t('search.sortRelevance'),
                newest: t('search.sortNewest'),
                followers: t('search.sortFollowers'),
              };
              const active = filters.sortBy === s;
              return (
                <Pressable
                  key={s}
                  style={[styles.sortChip, active && styles.sortChipActive]}
                  onPress={() => store.setSortBy(s)}
                >
                  <Ionicons
                    name="swap-vertical-outline"
                    size={12} // brand-guard-allow: sort chip glyph sits below the 14pt scale floor
                    color={active ? colors.textInverse : colors.textSecondary}
                  />
                  <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                    {labels[s]}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

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
