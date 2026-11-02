import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { KcRefreshControl } from './lists/KcRefreshControl';
import type { ViewToken } from 'react-native';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import type { useTranslatedPosts } from '../hooks/useTranslatedPosts';
import { HOME_FEED_GRID_COLUMNS, usePostGridCardWidth } from '../hooks/useShellContentWidth';
import { LIST_END_THRESHOLD } from '../hooks/usePrefetchNextPage';
import { prefetchImages } from '../lib/imagePrefetch';
import { getSupabaseFeedImageUrl } from '../lib/imageUrl';
import { useShellTabBarScrollInset } from '../navigation/useShellTabBarVisibility';
import { PostCardGrid } from './PostCardGrid';
import { EmptyState } from './EmptyState';
import { PrimaryButton } from './ui/Buttons';
import { PostGridSkeleton } from './skeletons/PostGridSkeleton';
import { finishMark } from '../lib/observability/perfMarks';
import { KcFlashList, type KcFlashListRef } from './lists/KcFlashList';

interface Props {
  data: PostWithOwner[] | undefined;
  isLoading: boolean;
  isRefetching: boolean;
  isError: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onEndReached?: () => void;
  hasMore?: boolean;
  /** Override card-tap handler (used by guest feed for the join modal). */
  onCardPress?: (post: PostWithOwner) => void;
  /** Optional override for the empty state — Home Feed passes the warm empty state. */
  emptyComponent?: React.ReactNode;
  /** Optional sticky/scrollable banner rendered above the list. */
  ListHeaderComponent?: React.ReactNode;
  /** Forwarded to the underlying KcFlashList — used by the feed for scroll-to-top. */
  listRef?: React.Ref<KcFlashListRef<PostWithOwner>>;
  /** FR-TRANSLATE-003 — viewport tracking for viewport-gated translation. */
  onViewableItemsChanged?: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  viewabilityConfig?: { itemVisiblePercentThreshold?: number; minimumViewTime?: number };
  /** FR-TRANSLATE-003 — translated fields/status accessor for visible posts. */
  translations?: ReturnType<typeof useTranslatedPosts>;
}

export function PostFeedList({
  data,
  isLoading,
  isRefetching,
  isError,
  onRefresh,
  onRetry,
  onEndReached,
  hasMore,
  onCardPress,
  emptyComponent,
  ListHeaderComponent,
  listRef,
  onViewableItemsChanged,
  viewabilityConfig,
  translations,
}: Props) {
  const styles = usePostFeedListStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const tabBarPad = useShellTabBarScrollInset();
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: tabBarPad }] as const,
    [styles.listContent, tabBarPad],
  );

  const renderItem = useCallback(
    ({ item }: { item: PostWithOwner }) => (
      <View style={styles.cell}>
      <PostCardGrid
        post={item}
        onCardPress={onCardPress}
        translatedFields={translations?.getTranslatedFields(item.postId)}
        titleStatus={translations?.getStatus(item.postId, 'title')}
        descriptionStatus={translations?.getStatus(item.postId, 'description')}
      />
      </View>
    ),
    [onCardPress, translations, styles.cell],
  );

  const keyExtractor = useCallback((p: PostWithOwner) => p.postId, []);

  React.useEffect(() => {
    if ((data ?? []).length > 0) finishMark('feed.first_render');
  }, [data]);

  // Warm the image cache for the most recently loaded page (usually still
  // below the fold) so cards render with their photo instead of a placeholder.
  const cardWidth = usePostGridCardWidth(HOME_FEED_GRID_COLUMNS);
  React.useEffect(() => {
    const tail = (data ?? []).slice(-20);
    prefetchImages(
      tail.map((p) => {
        const first = p.mediaAssets[0];
        return first ? getSupabaseFeedImageUrl(first.bucket, first.path, cardWidth) : null;
      }),
    );
  }, [data, cardWidth]);

  if (isLoading && !data) {
    return <PostGridSkeleton columns={HOME_FEED_GRID_COLUMNS} count={HOME_FEED_GRID_COLUMNS * 3} />;
  }
  if (isError && (!data || data.length === 0)) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('feed.loadErrorTitle')}</Text>
        <PrimaryButton testID="feed-load-error-retry" label={t('general.retry')} size="md" onPress={onRetry} />
      </View>
    );
  }
  return (
    <KcFlashList
      ref={listRef}
      estimatedItemSize={280}
      style={styles.list}
      data={data ?? []}
      keyExtractor={keyExtractor}
      numColumns={HOME_FEED_GRID_COLUMNS}
      renderItem={renderItem}
      contentContainerStyle={listContentStyle as unknown as object}
      ListHeaderComponent={ListHeaderComponent as React.ComponentType | null | undefined}
      ListEmptyComponent={
        (emptyComponent as React.ReactElement) ?? (
          <EmptyState
            icon="search-outline"
            title={t('feed.noResults')}
            subtitle={t('feed.noResultsDesc')}
          />
        )
      }
      ListFooterComponent={
        hasMore && data && data.length > 0 ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null
      }
      refreshControl={
        <KcRefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
      }
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onEndReached={onEndReached}
      onEndReachedThreshold={LIST_END_THRESHOLD}
      showsVerticalScrollIndicator={false}
    />
  );
}

const usePostFeedListStyles = makeUseStyles(({ colors }) => ({
  list: { flex: 1, width: '100%', minWidth: 0, alignSelf: 'stretch' as const },
  center: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: spacing.xl,
    gap: spacing.base,
  },
  errorTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  row: { paddingHorizontal: spacing.base, gap: spacing.sm, marginBottom: spacing.sm },
  listContent: { paddingTop: spacing.base },
  /** Even grid: each column cell takes an equal share and centres its card. */
  cell: { width: `${100 / HOME_FEED_GRID_COLUMNS}%` as const, alignItems: 'center' as const, marginBottom: spacing.md },
  footer: { paddingVertical: spacing.base, alignItems: 'center' as const },
}));