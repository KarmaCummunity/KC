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
import { buildFeedListEntries, type FeedListEntry } from '../lib/feed/feedListLayout';
import { MatchesFeedSection } from './matching/MatchesFeedSection';

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
  /** Content under the last row (a world screen's community links), after the paging spinner. */
  footer?: React.ReactNode;
  /** Forwarded to the underlying KcFlashList — used by the feed for scroll-to-top. */
  listRef?: React.Ref<KcFlashListRef<PostWithOwner>>;
  /** FR-TRANSLATE-003 — viewport tracking for viewport-gated translation. */
  onViewableItemsChanged?: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  viewabilityConfig?: { itemVisiblePercentThreshold?: number; minimumViewTime?: number };
  /** FR-TRANSLATE-003 — translated fields/status accessor for visible posts. */
  translations?: ReturnType<typeof useTranslatedPosts>;
  /** Inject the matches banner in the feed every N posts while scrolling (0 = off). */
  matchesEveryNPosts?: number;
  /** Passed to inline matches strips in world feeds. */
  matchesWorldSlug?: string;
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
  footer,
  listRef,
  onViewableItemsChanged,
  viewabilityConfig,
  translations,
  matchesEveryNPosts = 0,
  matchesWorldSlug,
}: Props) {
  const styles = usePostFeedListStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const tabBarPad = useShellTabBarScrollInset();
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: tabBarPad }] as const,
    [styles.listContent, tabBarPad],
  );

  const useRowLayout = matchesEveryNPosts > 0;
  const listData = useMemo(() => {
    const posts = data ?? [];
    if (!useRowLayout) return posts;
    return buildFeedListEntries(posts, matchesEveryNPosts);
  }, [data, matchesEveryNPosts, useRowLayout]);

  const renderPostCell = useCallback(
    (item: PostWithOwner) => (
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

  const renderItem = useCallback(
    (info: { item: PostWithOwner | FeedListEntry }) => {
      const item = info.item;
      if (!useRowLayout) {
        return renderPostCell(item as PostWithOwner);
      }
      const entry = item as FeedListEntry;
      if (entry.kind === 'matches') {
        return (
          <View style={styles.matchesRow}>
            <MatchesFeedSection
              variant="feed"
              maxVisible={2}
              worldSlug={matchesWorldSlug}
              inlineKey={entry.key}
            />
          </View>
        );
      }
      return (
        <View style={styles.postRow}>
          {renderPostCell(entry.left)}
          {entry.right ? renderPostCell(entry.right) : <View style={styles.cell} />}
        </View>
      );
    },
    [useRowLayout, renderPostCell, matchesWorldSlug, styles.matchesRow, styles.postRow, styles.cell],
  );

  const keyExtractor = useCallback(
    (item: PostWithOwner | FeedListEntry) => {
      if (!useRowLayout) return (item as PostWithOwner).postId;
      return (item as FeedListEntry).key;
    },
    [useRowLayout],
  );

  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      if (!onViewableItemsChanged) return;
      if (!useRowLayout) {
        onViewableItemsChanged(info);
        return;
      }
      const flat: ViewToken[] = [];
      for (const token of info.viewableItems) {
        const entry = token.item as FeedListEntry | undefined;
        if (!entry || entry.kind === 'matches') continue;
        flat.push({ ...token, key: entry.left.postId, item: entry.left, isViewable: true });
        if (entry.right) {
          flat.push({ ...token, key: entry.right.postId, item: entry.right, isViewable: true });
        }
      }
      onViewableItemsChanged({ viewableItems: flat, changed: info.changed });
    },
    [onViewableItemsChanged, useRowLayout],
  );

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
      ref={listRef as React.Ref<KcFlashListRef<PostWithOwner | FeedListEntry>> | undefined}
      estimatedItemSize={280}
      style={styles.list}
      data={listData}
      keyExtractor={keyExtractor}
      numColumns={useRowLayout ? 1 : HOME_FEED_GRID_COLUMNS}
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
        <>
          {hasMore && data && data.length > 0 ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
          {footer}
        </>
      }
      refreshControl={
        <KcRefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
      }
      onViewableItemsChanged={handleViewableItemsChanged}
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
  postRow: { flexDirection: 'row' as const, width: '100%' as const, marginBottom: spacing.md },
  matchesRow: { width: '100%' as const, marginBottom: spacing.md },
  footer: { paddingVertical: spacing.base, alignItems: 'center' as const },
}));