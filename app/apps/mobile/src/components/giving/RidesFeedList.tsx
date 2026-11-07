// The rides hub feed (#1626; docs/spec/05_giving_worlds.md §5.3 "Feed", D75; G49): every
// upcoming offer and request, soonest first, under "today / tomorrow / later"; departed rides
// are hidden. Rendered like every other world feed: the shared `ListingCard` in a 2-column
// grid. Each section row holds one grid row, so the day headings span the full width.
import React from 'react';
import { SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { RideFeedItem } from '@kc/domain';
import { ListingCard } from '../cards/ListingCard';
import { kcGridCell } from '../cards/KcCard.styles';
import { KcRefreshControl } from '../lists/KcRefreshControl';
import { EmptyState, EmptyStateActions } from '../EmptyState';
import { PrimaryButton } from '../ui/Buttons';
import { PostGridSkeleton } from '../skeletons/PostGridSkeleton';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { createRouteFor } from '../../lib/unifiedCreate/createCategories';
import { rideFeedCardExtras, rideFeedCardRow, rideFeedGridSections } from '../../lib/rides/ridesHubFeed';
import type { RidesHubFeedState } from '../../hooks/useRidesHubFeed';

interface Props {
  readonly feed: RidesHubFeedState;
  readonly header: React.ReactElement;
  readonly footer?: React.ReactElement;
}

export function RidesFeedList({ feed, header, footer }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const sections = rideFeedGridSections(feed.sections);

  return (
    <SectionList
      testID="rides-feed"
      sections={sections}
      keyExtractor={(row) => row.map((item) => item.listingId).join('|')}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={{ paddingBottom: inset }}
      stickySectionHeadersEnabled={false}
      refreshControl={<KcRefreshControl refreshing={feed.isRefreshing} onRefresh={feed.refresh} />}
      renderSectionHeader={({ section }) => (
        <Text style={styles.section} testID={`rides-feed-${section.group}`}>{t(`rideFeed.group.${section.group}`)}</Text>
      )}
      renderItem={({ item: row }) => (
        <View style={styles.gridRow}>
          {row.map((item) => <RideFeedCell key={item.listingId} item={item} />)}
        </View>
      )}
      ListEmptyComponent={feed.isLoading ? <PostGridSkeleton columns={2} /> : <RidesFeedEmpty feed={feed} />}
    />
  );
}

/** One ride as the shared listing card; a tap opens the ride. */
function RideFeedCell({ item }: Readonly<{ item: RideFeedItem }>) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={kcGridCell} testID={`rides-feed-item-${item.listingId}`}>
      <ListingCard
        item={rideFeedCardRow(item)}
        extraDetails={rideFeedCardExtras(item, t)}
        onPress={() =>
          router.push({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: item.listingId } })
        }
      />
    </View>
  );
}

/** Empty feed: a load error with retry, a narrowed feed with "clear", or an invite to publish. */
function RidesFeedEmpty({ feed }: Readonly<{ feed: RidesHubFeedState }>) {
  const { t } = useTranslation();
  const router = useRouter();
  if (feed.isError) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title={t('general.errorTitle')}
        subtitle={t('rideFeed.error')}
        action={<PrimaryButton testID="rides-feed-retry" label={t('general.retry')} size="md" onPress={feed.refresh} />}
      />
    );
  }
  const publish = {
    label: t('rideFeed.publishCta'),
    onPress: () => router.push(createRouteFor('rides')),
    testID: 'rides-feed-empty-create',
  };
  return (
    <EmptyState
      icon="car-outline"
      title={t(feed.refined ? 'donations.rides.empty' : 'rideFeed.empty')}
      subtitle={feed.refined ? t('donations.rides.emptyFiltered') : undefined}
      action={
        <EmptyStateActions
          primary={publish}
          secondary={
            feed.refined
              ? { label: t('rideFeed.clearFilters'), onPress: feed.clear, testID: 'rides-feed-empty-clear' }
              : undefined
          }
        />
      }
    />
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  section: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  // Default `row` follows the layout direction, so the first card sits at the reading start.
  gridRow: { flexDirection: 'row' as const },
}));
