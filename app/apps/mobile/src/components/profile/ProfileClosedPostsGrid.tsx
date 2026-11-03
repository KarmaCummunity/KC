// app/apps/mobile/src/components/profile/ProfileClosedPostsGrid.tsx
// Grid + loader + empty state for the closed-posts tab.
// Mapped to: FR-PROFILE-001 AC4 (revised), FR-PROFILE-002 AC2 (revised).

import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { PROFILE_GRID_COLUMNS } from '../../hooks/useShellContentWidth';
import type { ProfileClosedPostsItem } from '@kc/domain';
import { chunkArray } from '../../lib/chunkArray';
import { postWithOwnerFromPost, type ProfilePostOwnerContext } from '../../lib/postWithOwnerFromPost';
import { PostCardGrid } from '../PostCardGrid';
import { EmptyState } from '../EmptyState';

export type ClosedEmptyVariant = 'self_closed' | 'self_hidden_closed' | 'other_closed';

export interface ProfileClosedPostsGridProps {
  items: ProfileClosedPostsItem[];
  isLoading: boolean;
  empty: ClosedEmptyVariant;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Profile whose closed-posts tab is shown — forwarded to post detail for D-31 identity projection. */
  profileUserId: string;
  /** Profile owner context for PostMenuButton / post detail (not shown on grid cards). */
  postOwner?: ProfilePostOwnerContext;
}

function ProfileClosedPostsGridInner({
  items,
  isLoading,
  empty,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  profileUserId,
  postOwner,
}: ProfileClosedPostsGridProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const EMPTY_COPY: Record<ClosedEmptyVariant, {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> = {
    self_closed: {
      title: t('profile.emptyClosedTitleSelf'),
      subtitle: t('profile.emptySelfClosedSubtitle'),
      icon: 'archive-outline',
    },
    self_hidden_closed: {
      title: t('profile.emptyHiddenClosedTitle'),
      subtitle: t('profile.emptyHiddenClosedSubtitle'),
      icon: 'eye-off-outline',
    },
    other_closed: {
      title: t('profile.emptyClosedTitle'),
      subtitle: t('profile.emptyOtherClosedSubtitle'),
      icon: 'archive-outline',
    },
  };

  const chunkedRows = React.useMemo(() => {
    const mapped = items.map((it) => ({
      postWithOwner: postWithOwnerFromPost(it.post, postOwner),
      identityRole: it.identityRole,
    }));
    return chunkArray(mapped, PROFILE_GRID_COLUMNS);
  }, [items, postOwner]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (items.length === 0) {
    const e = EMPTY_COPY[empty];
    return <EmptyState icon={e.icon} title={e.title} subtitle={e.subtitle} />;
  }
  return (
    <>
      <View style={styles.grid}>
        {chunkedRows.map((row, rowIndex) => (
          <View key={row[0]?.postWithOwner.postId ?? rowIndex} style={styles.row}>
            {row.map(({ postWithOwner, identityRole }) => (
              <PostCardGrid
                key={postWithOwner.postId}
                post={postWithOwner}
                columns={PROFILE_GRID_COLUMNS}
                gap={spacing.xs}
                identityRole={identityRole}
                closedPostsProfileUserId={profileUserId}
              />
            ))}
          </View>
        ))}
      </View>
      {hasMore && onLoadMore ? (
        <View style={styles.loadMoreRow}>
          <TouchableOpacity
            style={[styles.loadMoreBtn, isLoadingMore && styles.loadMoreBtnBusy]}
            onPress={onLoadMore}
            disabled={isLoadingMore}
            accessibilityRole="button"
          >
            {isLoadingMore ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.loadMoreText}>{t('feed.loadMore')}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );
}

export const ProfileClosedPostsGrid = React.memo(ProfileClosedPostsGridInner);

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  loading: { padding: spacing.xl, alignItems: 'center' },
  grid: {
    width: '100%',
    alignSelf: 'stretch' as const,
    paddingHorizontal: spacing.base,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    gap: spacing.xs,
    width: '100%',
    alignSelf: 'stretch' as const,
  },
  loadMoreRow: { paddingVertical: spacing.lg, alignItems: 'center' },
  loadMoreBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    minWidth: 140,
    alignItems: 'center',
  },
  loadMoreBtnBusy: { opacity: 0.6 },
  loadMoreText: { ...typography.button, color: colors.primary },
}));
