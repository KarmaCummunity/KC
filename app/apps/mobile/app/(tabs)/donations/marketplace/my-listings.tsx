import React, { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { MyListingRow } from '@kc/domain';
import { KcRowCard } from '../../../../src/components/cards/KcRowCard';
import { listingWorldIcon } from '../../../../src/components/cards/ListingCard';
import { cleanDisplayTitle } from '../../../../src/lib/displayTitle';
import { Screen } from '../../../../src/components/ui/Screen';
import {
  useInvalidateMyListings,
  useMyMarketplaceListings,
} from '../../../../src/hooks/useMyMarketplaceListings';
import { marketplaceRepository } from '../../../../src/services/marketplaceComposition';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { LIST_END_THRESHOLD } from '../../../../src/hooks/usePrefetchNextPage';

const useStyles = makeUseStyles(({ colors }) => ({
  header: { padding: spacing.md, gap: spacing.xs },
  title: { ...typography.h2, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  btnDanger: { backgroundColor: colors.errorLight },
  btnText: { ...typography.caption, ...typography.semiBold, color: colors.textPrimary },
  empty: { padding: spacing.lg, textAlign: 'center' as const },
}));

const ROW = { marginHorizontal: spacing.md };

function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]);
  });
}

export default function MyListingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const myQuery = useMyMarketplaceListings();
  const { isLoading, refetch } = myQuery;
  const rows = useMemo(() => myQuery.data?.pages.flatMap((p) => p.rows) ?? [], [myQuery.data?.pages]);
  const invalidate = useInvalidateMyListings();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(listingId: string, fn: () => Promise<void>) {
    setBusyId(listingId);
    try {
      await fn();
      await invalidate();
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  const renderActions = (item: MyListingRow) => {
    const busy = busyId === item.listingId;
    const repo = marketplaceRepository();
    return (
      <View style={styles.actions}>
        {item.status === 'open' || item.status === 'cancelled' ? (
          <Pressable
            style={styles.btn}
            disabled={busy}
            onPress={() => router.push(`/(tabs)/donations/marketplace/my-listings/edit/${item.listingId}`)}
          >
            <Text style={styles.btnText}>{t('marketplace.myListingsEdit')}</Text>
          </Pressable>
        ) : null}
        {item.status === 'open' ? (
          <>
            <Pressable
              style={styles.btn}
              disabled={busy}
              onPress={() => {
                void act(item.listingId, () => repo.pauseMyListing(item.listingId));
              }}
            >
              <Text style={styles.btnText}>{t('marketplace.myListingsPause')}</Text>
            </Pressable>
            <Pressable
              style={styles.btn}
              disabled={busy}
              onPress={async () => {
                const ok = await confirmAsync(
                  t('marketplace.myListingsFulfillTitle'),
                  t('marketplace.myListingsFulfillHint'),
                );
                if (ok) await act(item.listingId, () => repo.fulfillMyListing(item.listingId));
              }}
            >
              <Text style={styles.btnText}>{t('marketplace.myListingsFulfill')}</Text>
            </Pressable>
          </>
        ) : null}
        {item.status === 'cancelled' ? (
          <Pressable
            style={styles.btn}
            disabled={busy}
            onPress={() => {
              void act(item.listingId, () => repo.resumeMyListing(item.listingId));
            }}
          >
            <Text style={styles.btnText}>{t('marketplace.myListingsResume')}</Text>
          </Pressable>
        ) : null}
        {['open', 'cancelled', 'closed'].includes(item.status) ? (
          <Pressable
            style={[styles.btn, styles.btnDanger]}
            disabled={busy}
            onPress={async () => {
              const ok = await confirmAsync(
                t('marketplace.myListingsDeleteTitle'),
                t('marketplace.myListingsDeleteHint'),
              );
              if (ok) await act(item.listingId, () => repo.deleteMyListing(item.listingId));
            }}
          >
            <Text style={styles.btnText}>{t('marketplace.myListingsDelete')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>{t('marketplace.myListingsTitle')}</Text>
        <Text style={styles.hint}>{t('marketplace.myListingsSubtitle')}</Text>
      </View>
      <KcFlashList
        data={rows}
        keyExtractor={(item) => item.listingId}
        contentContainerStyle={{ paddingBottom: inset }}
        onEndReached={() => {
          if (myQuery.hasNextPage && !myQuery.isFetchingNextPage) void myQuery.fetchNextPage();
        }}
        onEndReachedThreshold={LIST_END_THRESHOLD}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? t('marketplace.loading') : t('marketplace.myListingsEmpty')}
          </Text>
        }
        renderItem={({ item }) => (
          <KcRowCard
            testID={`my-listing-row-${item.listingId}`}
            containerStyle={ROW}
            tone={item.direction === 'request' ? 'request' : 'give'}
            badgeLabel={t(item.direction === 'request' ? 'feed.requestTypeShort' : 'feed.giveTypeShort')}
            placeholderIcon={listingWorldIcon(item.worldSlug)}
            title={cleanDisplayTitle(item.title)}
            meta={[
              `${t(`marketplace.world.${item.worldSlug}`, { defaultValue: item.worldSlug })} · ${t('marketplace.myListingsUpdated', {
                date: new Date(item.updatedAt).toLocaleDateString(),
              })}`,
              // KC#1298: tell the owner why a reported listing no longer shows to others.
              item.status === 'hidden_pending_review' ? t('marketplace.myListingsHiddenHint') : null,
            ]}
            statusLabel={t(`marketplace.listingStatus.${item.status}`, { defaultValue: item.status })}
            closed={item.status === 'closed'}
            closedLabel={t('cards.closed')}
            onPress={() => router.push(`/(tabs)/donations/marketplace/${item.listingId}`)}
            footer={renderActions(item)}
          />
        )}
      />
    </Screen>
  );
}
