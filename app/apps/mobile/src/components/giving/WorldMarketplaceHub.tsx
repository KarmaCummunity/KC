// Mapped to spec: FR-FEED-020 AC2 — a giving world's screen (items, food, knowledge): the
// world header (intro, request / offer, sub-screens), search within the world, and the
// world's feed of open offers and requests with its refinements, paged as the user scrolls.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@kc/ui';
import type { DonationCategorySlug, MarketplaceBrowseRow } from '@kc/domain';
import { Screen } from '../ui/Screen';
import { KcFlashList } from '../lists/KcFlashList';
import { KcRefreshControl } from '../lists/KcRefreshControl';
import { ListingCard } from '../cards/ListingCard';
import { kcGridCell } from '../cards/KcCard.styles';
import { EmptyState, EmptyStateActions } from '../EmptyState';
import { PrimaryButton } from '../ui/Buttons';
import { PostGridSkeleton } from '../skeletons/PostGridSkeleton';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { LIST_END_THRESHOLD } from '../../hooks/usePrefetchNextPage';
import { useWorldFeed, type WorldFeedState } from '../../hooks/useWorldFeed';
import { createRouteFor } from '../../lib/unifiedCreate/createCategories';
import { WorldHubHeader, type WorldHubHeaderProps } from './WorldHubHeader';
import { WorldLinksSection } from './WorldLinksSection';
import { WorldFeedControls } from './WorldFeedControls';

export type WorldMarketplaceHubProps = WorldHubHeaderProps & {
  readonly worldSlug: string;
  /** Community links list shown under the feed (FR-DONATE-007). */
  readonly linksCategory?: DonationCategorySlug;
  /** Secondary line per card; defaults to the listing summary. */
  readonly rowMeta?: (item: MarketplaceBrowseRow) => string | null;
};

export function WorldMarketplaceHub({ rowMeta, worldSlug, linksCategory, ...headerProps }: WorldMarketplaceHubProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const inset = useShellTabBarScrollInset();
  const feed = useWorldFeed(worldSlug);

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
            <WorldFeedControls worldSlug={worldSlug} feed={feed} />
          </>
        }
        ListFooterComponent={linksCategory ? <WorldLinksSection categorySlug={linksCategory} /> : null}
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
        ListEmptyComponent={
          feed.isLoading ? (
            <PostGridSkeleton columns={2} />
          ) : feed.isError && feed.rows.length === 0 ? (
            <EmptyState
              icon="cloud-offline-outline"
              title={t('general.errorTitle')}
              subtitle={t('errorBoundary.body')}
              action={
                <PrimaryButton
                  testID="world-feed-retry"
                  label={t('general.retry')}
                  size="md"
                  onPress={feed.refresh}
                />
              }
            />
          ) : (
            <WorldFeedEmpty worldSlug={worldSlug} feed={feed} />
          )
        }
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
