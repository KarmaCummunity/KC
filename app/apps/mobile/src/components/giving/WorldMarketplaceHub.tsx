// Mapped to spec: FR-FEED-020 AC2 — a giving world's screen (items, food, housing, animals,
// knowledge, time): the world header in the TopBar (title menu of the world's screens, map,
// filter button), a one-line intro, and the world's feed. The feed is the main feed narrowed to
// the world: the same post card (`PostFeedList` → `PostCardGrid`) and the same filter sheet
// (`PostFilterSheet`: search, sort, filters) with the world locked.
import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { DonationCategorySlug } from '@kc/domain';
import { Screen } from '../ui/Screen';
import { PostFeedList } from '../PostFeedList';
import { PostFilterSheet } from '../PostFilterSheet';
import { EmptyState, EmptyStateActions } from '../EmptyState';
import { useWorldPostFeed, type WorldPostFeedState } from '../../hooks/useWorldPostFeed';
import { createRouteFor } from '../../lib/unifiedCreate/createCategories';
import { WorldHubHeader, type WorldHubHeaderProps } from './WorldHubHeader';
import { FEED_MATCHES_EVERY_N_POSTS } from '../../lib/feed/feedListLayout';
import { WorldLinksSection } from './WorldLinksSection';
import { useWorldHeader } from './useWorldHeader';

export type WorldMarketplaceHubProps = WorldHubHeaderProps & {
  readonly worldSlug: string;
  /** Community links list shown under the feed (FR-DONATE-007). */
  readonly linksCategory?: DonationCategorySlug;
};

export function WorldMarketplaceHub({ worldSlug, linksCategory, subScreens = [], ...headerProps }: WorldMarketplaceHubProps) {
  const feed = useWorldPostFeed(worldSlug);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const screensMenu = useWorldHeader({
    worldSlug,
    subScreens,
    activeFilterCount: feed.activeFilterCount,
    onOpenFilters: openFilters,
    mapFilter: feed.value,
  });

  return (
    <Screen blobs="off" hasNativeHeader testID="world-feed-list">
      <PostFeedList
        data={feed.posts}
        isLoading={feed.isLoading}
        isRefetching={feed.isRefetching}
        isError={feed.isError}
        onRefresh={feed.refresh}
        onRetry={feed.refresh}
        hasMore={feed.hasMore}
        onEndReached={feed.loadMore}
        ListHeaderComponent={<WorldHubHeader {...headerProps} />}
        matchesEveryNPosts={FEED_MATCHES_EVERY_N_POSTS}
        matchesWorldSlug={worldSlug}
        footer={linksCategory ? <WorldLinksSection categorySlug={linksCategory} /> : null}
        emptyComponent={<WorldFeedEmpty worldSlug={worldSlug} feed={feed} />}
      />
      <PostFilterSheet
        visible={filtersOpen}
        value={feed.value}
        onPatch={feed.patch}
        onClear={feed.clear}
        onClose={() => setFiltersOpen(false)}
        lockedWorld
      />
      {screensMenu}
    </Screen>
  );
}

/** Empty world feed: invite the first post, or clear the search and filters that hid them. */
function WorldFeedEmpty({ worldSlug, feed }: { readonly worldSlug: string; readonly feed: WorldPostFeedState }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <EmptyState
      icon={feed.searching ? 'search-outline' : 'storefront-outline'}
      title={
        feed.searching
          ? t('emptyStates.marketplaceSearchTitle', { query: feed.searchedQuery })
          : t('donations.worldFeed.emptyTitle')
      }
      subtitle={t('donations.worldFeed.emptyBody')}
      action={
        <EmptyStateActions
          primary={{
            label: t('emptyStates.marketplaceCreate'),
            onPress: () => router.push(createRouteFor(worldSlug)),
            testID: 'world-feed-empty-create',
          }}
          secondary={
            feed.refined
              ? { label: t('emptyStates.marketplaceClear'), onPress: feed.clear, testID: 'world-feed-empty-clear' }
              : undefined
          }
        />
      }
    />
  );
}
