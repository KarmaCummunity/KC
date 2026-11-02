// The rides hub feed (docs/spec/05_giving_worlds.md §5.3 "Feed", D75; gap G49): offers and
// requests together, soonest first, under "today / tomorrow / later"; departed rides are hidden.
import React from 'react';
import { RefreshControl, SectionList } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { RideFeedGroup, RideFeedItem } from '@kc/domain';
import { loadRidesFeed, RIDES_FEED_QUERY_KEY } from '../../services/ridesFeedComposition';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { rideSeriesLabel } from '../../lib/rides/rideSeriesLabel';
import { KcRowCard } from '../cards/KcRowCard';

/** The feed refreshes every minute so departed rides drop off while the hub stays open. */
const REFRESH_MS = 60_000;

/** Today and tomorrow need only the time; later rides need the day too. */
const TIME_FORMAT: Record<RideFeedGroup, string> = { today: 'HH:mm', tomorrow: 'HH:mm', later: 'EEEE d/M · HH:mm' };

export function RidesFeedList({ header }: Readonly<{ header: React.ReactElement }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const feed = useQuery({ queryKey: RIDES_FEED_QUERY_KEY, queryFn: loadRidesFeed, refetchInterval: REFRESH_MS });

  const sections = (feed.data ?? []).map((s) => ({ group: s.group, data: [...s.items] }));

  const meta = (item: RideFeedItem, group: RideFeedGroup) => [
    format(new Date(item.departsAt), TIME_FORMAT[group], { locale: dateFnsHe }),
    item.direction === 'give'
      ? item.seatsLeft ? t('rideFeed.seatsLeft', { count: item.seatsLeft }) : t('rideFeed.full')
      : t('rideFeed.passengers', { count: item.passengers ?? 1 }),
    item.meetingPoints > 0 ? t('rideFeed.meetingPoints', { count: item.meetingPoints }) : null,
    // A recurring ride's occurrence says when the ride repeats (FR-RIDE-046).
    item.recurrence ? rideSeriesLabel(item.recurrence, t) : null,
  ];

  return (
    <SectionList
      testID="rides-feed"
      sections={sections}
      keyExtractor={(item) => item.listingId}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: inset }}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />}
      renderSectionHeader={({ section }) => (
        <Text style={styles.section} testID={`rides-feed-${section.group}`}>{t(`rideFeed.group.${section.group}`)}</Text>
      )}
      renderItem={({ item, section }) => (
        <KcRowCard
          testID={`rides-feed-item-${item.listingId}`}
          tone={item.direction === 'give' ? 'give' : 'request'}
          badgeLabel={t(item.direction === 'give' ? 'cards.rideOffer' : 'cards.rideRequest')}
          placeholderIcon="car-outline"
          title={item.originLabel && item.destLabel ? `${item.originLabel} → ${item.destLabel}` : cleanDisplayTitle(item.title)}
          meta={meta(item, section.group)}
          onPress={() => router.push({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: item.listingId } })}
        />
      )}
      ListEmptyComponent={feed.isLoading ? null : <Text style={styles.empty}>{t(feed.isError ? 'rideFeed.error' : 'rideFeed.empty')}</Text>}
    />
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  section: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  empty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' as const },
}));
