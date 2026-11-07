import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { textAlignStart } from '../../../../src/lib/rtlLayout';
import type { MyListingRow } from '@kc/domain';
import { KcRowCard } from '../../../../src/components/cards/KcRowCard';
import { listingWorldIcon } from '../../../../src/components/cards/ListingCard';
import { cleanDisplayTitle } from '../../../../src/lib/displayTitle';
import { Screen } from '../../../../src/components/ui/Screen';
import { useMyMarketplaceListings } from '../../../../src/hooks/useMyMarketplaceListings';
import { useMyListingActions } from '../../../../src/hooks/useMyListingActions';
import { MyListingsClosureHost } from '../../../../src/components/marketplace/MyListingsClosureHost';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { LIST_END_THRESHOLD } from '../../../../src/hooks/usePrefetchNextPage';
import { WorldSubScreenChrome } from '../../../../src/components/giving/useWorldHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
  header: { padding: spacing.md, gap: spacing.xs },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: textAlignStart() },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  btnDanger: { backgroundColor: colors.errorLight },
  btnText: { ...typography.caption, ...typography.semiBold, color: colors.textPrimary },
  empty: { padding: spacing.lg, textAlign: 'center' as const },
}));

const ROW = { marginHorizontal: spacing.md };

const myListingKeyExtractor = (item: MyListingRow) => item.listingId;


interface MyListingRowItemProps {
  readonly item: MyListingRow;
  readonly busy: boolean;
  readonly onOpen: (listingId: string) => void;
  readonly onEdit: (listingId: string) => void;
  readonly onPause: (listingId: string) => void;
  readonly onFulfill: (listing: MyListingRow) => void;
  readonly onResume: (listingId: string) => void;
  readonly onDelete: (listingId: string) => void;
  readonly onAddPhotos: (listingId: string) => void;
  readonly styles: ReturnType<typeof useStyles>;
}

const MyListingRowItem = React.memo(function MyListingRowItem({
  item,
  busy,
  onOpen,
  onEdit,
  onPause,
  onFulfill,
  onResume,
  onDelete,
  onAddPhotos,
  styles,
}: MyListingRowItemProps) {
  const { t } = useTranslation();

  const handleOpen = useCallback(() => onOpen(item.listingId), [item.listingId, onOpen]);
  const handleEdit = useCallback(() => onEdit(item.listingId), [item.listingId, onEdit]);
  const handlePause = useCallback(() => onPause(item.listingId), [item.listingId, onPause]);
  const handleFulfill = useCallback(() => onFulfill(item), [item, onFulfill]);
  const handleResume = useCallback(() => onResume(item.listingId), [item.listingId, onResume]);
  const handleDelete = useCallback(() => onDelete(item.listingId), [item.listingId, onDelete]);
  const handleAddPhotos = useCallback(() => onAddPhotos(item.listingId), [item.listingId, onAddPhotos]);

  const meta = useMemo(
    () => [
      `${t(`marketplace.world.${item.worldSlug}`, { defaultValue: item.worldSlug })} · ${t('marketplace.myListingsUpdated', {
        date: new Date(item.updatedAt).toLocaleDateString(),
      })}`,
      item.status === 'hidden_pending_review' ? t('marketplace.myListingsHiddenHint') : null,
      item.status === 'cancelled' ? t('marketplace.myListingsPausedHint') : null,
      item.status === 'closed' ? t('marketplace.myListingsClosedHint') : null,
    ],
    [item.status, item.updatedAt, item.worldSlug, t],
  );

  const footer = (
    <View style={styles.actions}>
      {item.status === 'open' || item.status === 'cancelled' ? (
        <Pressable style={styles.btn} disabled={busy} onPress={handleEdit}>
          <Text style={styles.btnText}>{t('marketplace.myListingsEdit')}</Text>
        </Pressable>
      ) : null}
      {item.status === 'open' ? (
        <>
          <Pressable style={styles.btn} disabled={busy} onPress={handlePause}>
            <Text style={styles.btnText}>{t('marketplace.myListingsPause')}</Text>
          </Pressable>
          <Pressable style={styles.btn} disabled={busy} onPress={handleFulfill}>
            <Text style={styles.btnText}>
              {item.direction === 'give' ? t('closure.assignUserCta') : t('marketplace.myListingsFulfill')}
            </Text>
          </Pressable>
        </>
      ) : null}
      {item.status === 'cancelled' ? (
        <Pressable style={styles.btn} disabled={busy} onPress={handleResume}>
          <Text style={styles.btnText}>{t('marketplace.myListingsResume')}</Text>
        </Pressable>
      ) : null}
      {['open', 'cancelled', 'closed'].includes(item.status) ? (
        <Pressable style={styles.btn} disabled={busy} onPress={handleAddPhotos} testID={`my-listing-add-photos-${item.listingId}`}>
          <Text style={styles.btnText}>{t('marketplace.myListingsAddPhotos')}</Text>
        </Pressable>
      ) : null}
      {['open', 'cancelled', 'closed'].includes(item.status) ? (
        <Pressable style={[styles.btn, styles.btnDanger]} disabled={busy} onPress={handleDelete}>
          <Text style={styles.btnText}>{t('marketplace.myListingsDelete')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <KcRowCard
      testID={`my-listing-row-${item.listingId}`}
      containerStyle={ROW}
      tone={item.direction === 'request' ? 'request' : 'give'}
      badgeLabel={t(item.direction === 'request' ? 'feed.requestTypeShort' : 'feed.giveTypeShort')}
      placeholderIcon={listingWorldIcon(item.worldSlug)}
      title={cleanDisplayTitle(item.title)}
      meta={meta}
      statusLabel={t(`marketplace.listingStatus.${item.status}`, { defaultValue: item.status })}
      closed={item.status === 'closed'}
      closedLabel={t('cards.closed')}
      onPress={handleOpen}
      footer={footer}
    />
  );
});

export default function MyListingsScreen() {
  const { t } = useTranslation();
  const { world: worldParam } = useLocalSearchParams<{ world?: string | string[] }>();
  const worldSlug = typeof worldParam === 'string' ? worldParam : Array.isArray(worldParam) ? worldParam[0] : undefined;
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const myQuery = useMyMarketplaceListings();
  const { isLoading, refetch } = myQuery;
  const rows = useMemo(() => myQuery.data?.pages.flatMap((p) => p.rows) ?? [], [myQuery.data?.pages]);
  const actions = useMyListingActions(refetch);

  const handleOpen = useCallback(
    (listingId: string) => router.push(`/(tabs)/donations/marketplace/${listingId}`),
    [router],
  );

  const handleEdit = useCallback(
    (listingId: string) =>
      router.push({
        pathname: '/(tabs)/donations/marketplace/my-listings/edit/[listingId]',
        params: { listingId, ...(worldSlug ? { world: worldSlug } : {}) },
      }),
    [router, worldSlug],
  );

  const contentContainerStyle = useMemo(() => ({ paddingBottom: inset }), [inset]);

  const handleEndReached = useCallback(() => {
    if (myQuery.hasNextPage && !myQuery.isFetchingNextPage) void myQuery.fetchNextPage();
  }, [myQuery]);

  const renderItem = useCallback(
    ({ item }: { item: MyListingRow }) => (
      <MyListingRowItem
        item={item}
        busy={actions.busyId === item.listingId}
        onOpen={handleOpen}
        onEdit={handleEdit}
        onPause={actions.pause}
        onFulfill={actions.fulfill}
        onResume={actions.resume}
        onDelete={actions.remove}
        onAddPhotos={actions.addPhotos}
        styles={styles}
      />
    ),
    [actions, handleEdit, handleOpen, styles],
  );

  return (
    <>
      {worldSlug ? (
        <WorldSubScreenChrome worldSlug={worldSlug} activeScreenTestId="world-hub-my-listings" />
      ) : null}
      <Screen hasNativeHeader blobs="off">
      <View style={styles.header}>
        <Text style={styles.hint}>{t('marketplace.myListingsSubtitle')}</Text>
      </View>
      <MyListingsClosureHost onDone={() => { void refetch(); }} />
      <KcFlashList
        data={rows}
        keyExtractor={myListingKeyExtractor}
        estimatedItemSize={140}
        contentContainerStyle={contentContainerStyle}
        onEndReached={handleEndReached}
        onEndReachedThreshold={LIST_END_THRESHOLD}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? t('marketplace.loading') : t('marketplace.myListingsEmpty')}
          </Text>
        }
        renderItem={renderItem}
      />
      </Screen>
    </>
  );
}
