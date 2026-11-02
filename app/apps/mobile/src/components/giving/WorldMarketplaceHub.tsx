// Mapped to spec: FR-FEED-020 AC2 — a giving world's screen (items, food, knowledge): the
// world header (intro, request / offer, sub-screens), search within the world, and the
// world's feed of open offers and requests with its refinements, paged as the user scrolls.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@kc/ui';
import type { MarketplaceBrowseRow } from '@kc/domain';
import { Screen } from '../ui/Screen';
import { KcFlashList } from '../lists/KcFlashList';
import { KcRefreshControl } from '../lists/KcRefreshControl';
import { ListingCard } from '../cards/ListingCard';
import { kcGridCell } from '../cards/KcCard.styles';
import { EmptyState, EmptyStateActions } from '../EmptyState';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { LIST_END_THRESHOLD } from '../../hooks/usePrefetchNextPage';
import { useWorldFeed, type WorldFeedState } from '../../hooks/useWorldFeed';
import { createRouteFor } from '../../lib/unifiedCreate/createCategories';
import { WorldHubHeader, type WorldHubHeaderProps } from './WorldHubHeader';
import { WorldFeedControls } from './WorldFeedControls';

export type WorldMarketplaceHubProps = WorldHubHeaderProps & {
  /** Secondary line per card; defaults to the listing summary. */
  readonly rowMeta?: (item: MarketplaceBrowseRow) => string | null;
};

export function WorldMarketplaceHub({ rowMeta, ...headerProps }: WorldMarketplaceHubProps) {
  const router = useRouter();
  const inset = useShellTabBarScrollInset();
  const feed = useWorldFeed(headerProps.worldSlug);

  return (
    <Screen blobs="content">
      <KcFlashList
        testID="world-feed-list"
        data={feed.rows}
        keyExtractor={(item) => item.listingId}
        contentContainerStyle={{ paddingBottom: inset, paddingTop: spacing.sm }}
        ListHeaderComponent={
          <>
            <WorldHubHeader {...headerProps} />
            <WorldFeedControls worldSlug={headerProps.worldSlug} feed={feed} />
          </>
        }
        numColumns={2}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={LIST_END_THRESHOLD}
        refreshControl={<KcRefreshControl refreshing={feed.isRefreshing} onRefresh={feed.refresh} />}
        renderItem={({ item }) => (
          <View style={kcGridCell}>
            <ListingCard
              item={item}
              meta={rowMeta ? rowMeta(item) : undefined}
              onPress={() => router.push(`/(tabs)/donations/marketplace/${item.listingId}`)}
            />
          </View>
        )}
        ListEmptyComponent={feed.isLoading ? null : <WorldFeedEmpty worldSlug={headerProps.worldSlug} feed={feed} />}
      />
    </Screen>
  );
}

/** Empty world feed: invite the first listing, or clear the search and filters that hid them. */
function WorldFeedEmpty({ worldSlug, feed }: { readonly worldSlug: string; readonly feed: WorldFeedState }) {
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
