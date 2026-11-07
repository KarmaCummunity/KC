// Home Feed — wired to IPostRepository + IFeedRealtime + IStatsRepository (P1.2).
// Mapped to: FR-FEED-001, 002, 003, 004, 005, 006, 008, 009, 010, 014, 015.
//
// The Home Feed reads its filter from `filterStore` (persisted) and overlays
// session-only banners (new-posts pill, first-post nudge) via
// `feedSessionStore` (in-memory). Realtime INSERTs of public posts bump the
// counter; tapping the pill refetches + scrolls to top.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { TouchableOpacity, View, type ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, iconSize, spacing } from '@kc/ui';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import type { PostWithOwner } from '@kc/application';
import { PostFeedList } from '../../src/components/PostFeedList';
import { FEED_MATCHES_EVERY_N_POSTS } from '../../src/lib/feed/feedListLayout';
import { TopBar } from '../../src/components/TopBar';
import { FeedFilterIcon } from '../../src/components/FeedFilterIcon';
import { NewPostsBanner } from '../../src/components/NewPostsBanner';
import { FirstPostNudge } from '../../src/components/FirstPostNudge';
import { SurveyPromptBanner } from '../../src/components/survey/SurveyPromptBanner';
import { useSurveyBanner } from '../../src/hooks/useSurveyBanner';
import { CompleteProfileBanner } from '../../src/components/CompleteProfileBanner';
import { useCompleteProfileBanner } from '../../src/hooks/useCompleteProfileBanner';
import { FeedEmptyState } from '../../src/components/FeedEmptyState';
import { PostFilterSheet, type PostFilterValue } from '../../src/components/PostFilterSheet';
import { Screen } from '../../src/components/ui/Screen';
import { useAuthStore } from '../../src/store/authStore';
import type { KcFlashListRef } from '../../src/components/lists/KcFlashList';
import { useFilterStore } from '../../src/store/filterStore';
import { useFeedSessionStore } from '../../src/store/feedSessionStore';
import { useFeedRealtime } from '../../src/hooks/useFeedRealtime';
import { useFirstPostNudge } from '../../src/hooks/useFirstPostNudge';
import { useReaderLanguage } from '../../src/hooks/useReaderLanguage';
import { useTranslatedPosts } from '../../src/hooks/useTranslatedPosts';
import { getFeedUseCase } from '../../src/services/postsComposition';
import { encodeMapFilter } from '../../src/lib/postMap';
import { container } from '../../src/lib/container';
import { startMark } from '../../src/lib/observability/perfMarks';
import { useScreenAside } from '../../src/components/aside/useScreenAside';
import { GivingWorldsAside } from '../../src/components/aside/GivingWorldsAside';
import { usePrefetchNextPage } from '../../src/hooks/usePrefetchNextPage';
import { useFeedMuteFilters } from '../../src/hooks/useFeedMuteFilters';
import { countMuteFilters } from '../../src/lib/feedMuteFilters';

// Feed grid shows only the title, so only translate that field here (post
// detail translates the description on open). FR-TRANSLATE-003.
const FEED_TRANSLATABLE_FIELDS = ['title'] as const;

// Cold home-tab mount: fires once per JS context on module load.
startMark('feed.first_render');
startMark('image.first_paint');

export default function HomeFeedScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const viewerId = session?.userId ?? null;

  const filter = useFilterStore(
    useShallow((s) => ({
      type: s.type,
      worlds: s.worlds,
      subcategories: s.subcategories,
      categories: s.categories,
      itemConditions: s.itemConditions,
      locationFilter: s.locationFilter,
      statusFilter: s.statusFilter,
      sortOrder: s.sortOrder,
      proximitySortCity: s.proximitySortCity,
      proximitySortCityName: s.proximitySortCityName,
      followersOnly: s.followersOnly,
      searchQuery: s.searchQuery,
      clearAll: s.clearAll,
    })),
  );
  const sheetFilterCount = useFilterStore((s) => s.activeCount());
  const muteFilters = useFeedMuteFilters();
  const muteCount = countMuteFilters(muteFilters.list.data ?? []);
  const filterBadgeCount = sheetFilterCount + muteCount;
  const newPostsCount = useFeedSessionStore((s) => s.newPostsCount);
  const resetNewPosts = useFeedSessionStore((s) => s.resetNewPosts);

  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<KcFlashListRef<PostWithOwner>>(null);

  const feedFilter = useMemo(
    () => ({
      type: filter.type ?? undefined,
      worlds: filter.worlds,
      subcategories: filter.subcategories,
      categories: filter.categories,
      itemConditions: filter.itemConditions,
      locationFilter: filter.locationFilter ?? undefined,
      statusFilter: filter.statusFilter,
      sortOrder: filter.sortOrder,
      proximitySortCity: filter.proximitySortCity ?? undefined,
      followersOnly: filter.followersOnly,
      searchQuery:
        filter.searchQuery.trim().length >= 2 ? filter.searchQuery.trim() : undefined,
    }),
    [
      filter.type,
      filter.worlds,
      filter.subcategories,
      filter.categories,
      filter.itemConditions,
      filter.locationFilter,
      filter.statusFilter,
      filter.sortOrder,
      filter.proximitySortCity,
      filter.followersOnly,
      filter.searchQuery,
    ],
  );

  const feedQuery = useInfiniteQuery({
    queryKey: ['feed', viewerId, feedFilter],
    queryFn: ({ pageParam }) =>
      getFeedUseCase().execute({
        viewerId,
        filter: feedFilter,
        limit: 20,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  usePrefetchNextPage(feedQuery);

  const feedPosts = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.posts) ?? [],
    [feedQuery.data?.pages],
  );

  // FR-TRANSLATE-003 — viewport-gated read-time translation. Track post ids that
  // dwell in view (60% for 400ms), then materialize only their fields.
  const readerLanguage = useReaderLanguage();
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const loggedImpressionsRef = useRef(new Set<string>());
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      const ids = info.viewableItems.map((v) => String(v.key));
      setVisibleIds(ids);
      const fresh = ids.filter((id) => !loggedImpressionsRef.current.has(id));
      if (fresh.length > 0 && viewerId) {
        fresh.forEach((id) => loggedImpressionsRef.current.add(id));
        void container.socialFeed.logImpressions(fresh.slice(0, 25));
      }
    },
  ).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 400,
  }).current;
  const visiblePosts = useMemo(
    () => feedPosts.filter((p) => visibleIds.includes(p.postId)),
    [feedPosts, visibleIds],
  );
  const translations = useTranslatedPosts(visiblePosts, readerLanguage, FEED_TRANSLATABLE_FIELDS);

  const refetchAndReset = useCallback(() => {
    resetNewPosts();
    void feedQuery.refetch();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [feedQuery, resetNewPosts]);

  useFeedRealtime({
    queryClient,
    queryKey: ['feed', viewerId, feedFilter] as const,
    viewerId,
    feedFilter,
  });

  // Desktop (>=1024) aside — giving-worlds shortcuts (FR-RESP-003).
  useScreenAside(() => <GivingWorldsAside />, []);

  const nudge = useFirstPostNudge(viewerId);
  const surveyBanner = useSurveyBanner();
  const completeProfileBanner = useCompleteProfileBanner();

  const sheetValue: PostFilterValue = {
    type: filter.type,
    worlds: filter.worlds,
    subcategories: filter.subcategories,
    categories: filter.categories,
    itemConditions: filter.itemConditions,
    locationFilter: filter.locationFilter,
    statusFilter: filter.statusFilter,
    sortOrder: filter.sortOrder,
    proximitySortCity: filter.proximitySortCity,
    proximitySortCityName: filter.proximitySortCityName,
    followersOnly: filter.followersOnly,
    searchQuery: filter.searchQuery,
  };

  // Stable callback — zustand actions via getState() so SearchSection debounce
  // does not retrigger an infinite loop (React #185).
  const handleFilterPatch = useCallback((patch: Partial<PostFilterValue>) => {
    const s = useFilterStore.getState();
    if ('type' in patch) s.setType(patch.type ?? null);
    if ('worlds' in patch) s.setWorlds(patch.worlds ?? []);
    if ('subcategories' in patch) s.setSubcategories(patch.subcategories ?? []);
    if ('categories' in patch) s.setCategories(patch.categories ?? []);
    if ('itemConditions' in patch) s.setItemConditions(patch.itemConditions ?? []);
    if ('locationFilter' in patch) s.setLocationFilter(patch.locationFilter ?? null);
    if ('statusFilter' in patch) s.setStatusFilter(patch.statusFilter ?? 'open');
    if ('sortOrder' in patch) s.setSortOrder(patch.sortOrder ?? 'newest');
    if ('proximitySortCity' in patch || 'proximitySortCityName' in patch) {
      s.setProximitySortCity(patch.proximitySortCity ?? null, patch.proximitySortCityName ?? null);
    }
    if ('followersOnly' in patch) s.setFollowersOnly(patch.followersOnly ?? false);
    if ('searchQuery' in patch) s.setSearchQuery(patch.searchQuery ?? '');
  }, []);

  const header = (
    <View>
      {completeProfileBanner.shouldShow && <CompleteProfileBanner onDismiss={completeProfileBanner.onDismiss} />}
      {surveyBanner.shouldShow && (
        <SurveyPromptBanner slug={surveyBanner.slug} onSnooze={surveyBanner.onSnooze} />
      )}
      {nudge.show && (
        <FirstPostNudge
          onShare={() => router.push('/create')}
          onRemindLater={nudge.dismissForSession}
          onDismissForever={nudge.dismissForever}
        />
      )}
      <NewPostsBanner count={newPostsCount} onPress={refetchAndReset} />
    </View>
  );

  return (
    <Screen blobs="off" testID="feed-screen">
      <TopBar
        extraIcon={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/(tabs)/donations/marketplace/map', params: { filter: encodeMapFilter(sheetValue) } })
              }
              accessibilityRole="button"
              accessibilityLabel={t('feed.openMapA11y')}
              testID="feed-open-map"
              style={{ padding: spacing.xs }}
            >
              <Ionicons name="map-outline" size={iconSize['2xl']} color={colors.textPrimary} />
            </TouchableOpacity>
            <FeedFilterIcon activeCount={filterBadgeCount} onPress={() => setSheetOpen(true)} />
          </View>
        }
      />

      <PostFeedList
        listRef={listRef}
        data={feedPosts}
        isLoading={feedQuery.isLoading}
        isRefetching={feedQuery.isRefetching}
        isError={feedQuery.isError}
        onRefresh={refetchAndReset}
        onRetry={() => feedQuery.refetch()}
        hasMore={feedQuery.hasNextPage}
        onEndReached={() => {
          if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
            void feedQuery.fetchNextPage();
          }
        }}
        ListHeaderComponent={header}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        translations={translations}
        matchesEveryNPosts={FEED_MATCHES_EVERY_N_POSTS}
        emptyComponent={
          <FeedEmptyState
            hasSheetFilters={sheetFilterCount > 0}
            hasMutes={muteCount > 0}
            onClearFilters={() => filter.clearAll()}
            onShare={() => router.push('/create')}
            onOpenFeedSettings={() => router.push('/settings/feed')}
          />
        }
      />

      <PostFilterSheet
        visible={sheetOpen}
        value={sheetValue}
        onPatch={handleFilterPatch}
        onClear={() => filter.clearAll()}
        onClose={() => setSheetOpen(false)}
        onOpenFeedSettings={() => {
          setSheetOpen(false);
          router.push('/settings/feed');
        }}
      />
    </Screen>
  );
}