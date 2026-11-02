// app/apps/mobile/src/components/profile/ProfilePostsGrid.tsx
// Posts grid + loader + empty state. Used by both profile screens.
// Mapped to: FR-PROFILE-001 AC4, FR-PROFILE-002 AC3.

import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { PROFILE_GRID_COLUMNS } from '../../hooks/useShellContentWidth';
import type { Post } from '@kc/domain';
import { chunkArray } from '../../lib/chunkArray';
import { postWithOwnerFromPost, type ProfilePostOwnerContext } from '../../lib/postWithOwnerFromPost';
import { PostCardGrid } from '../PostCardGrid';
import { EmptyState } from '../EmptyState';
import { PrimaryButton } from '../ui/Buttons';
import { PostGridSkeleton } from '../skeletons/PostGridSkeleton';

export type EmptyVariant =
  | 'self_open'
  | 'self_closed'
  | 'self_saved_open'
  | 'self_saved_closed'
  | 'self_hidden_open'
  | 'self_removed_open'
  | 'self_removed_closed'
  | 'other_open'
  | 'other_closed';

export interface ProfilePostsGridProps {
  posts: Post[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty: EmptyVariant;
  /** Profile owner context for PostMenuButton / post detail (not shown on grid cards). */
  postOwner?: ProfilePostOwnerContext;
}

export function ProfilePostsGrid({ posts, isLoading, isError, onRetry, empty, postOwner }: ProfilePostsGridProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const EMPTY_COPY: Record<EmptyVariant, { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = {
    self_open: {
      title: t('profile.emptyOpenTitle'),
      subtitle: t('profile.emptySelfOpenSubtitle'),
      icon: 'mail-open-outline',
    },
    self_closed: {
      title: t('profile.emptyClosedTitleSelf'),
      subtitle: t('profile.emptySelfClosedSubtitleLegacy'),
      icon: 'archive-outline',
    },
    self_saved_open: {
      title: t('profile.emptySavedOpenTitle'),
      subtitle: t('profile.emptySavedOpenSubtitle'),
      icon: 'bookmark-outline',
    },
    self_saved_closed: {
      title: t('profile.emptySavedClosedTitle'),
      subtitle: t('profile.emptySavedClosedSubtitle'),
      icon: 'bookmark-outline',
    },
    self_hidden_open: {
      title: t('profile.emptyHiddenOpenTitle'),
      subtitle: t('profile.emptyHiddenOpenSubtitle'),
      icon: 'eye-off-outline',
    },
    self_removed_open: {
      title: t('profile.emptyRemovedOpenTitle'),
      subtitle: t('profile.emptyRemovedOpenSubtitle'),
      icon: 'shield-outline',
    },
    self_removed_closed: {
      title: t('profile.emptyRemovedClosedTitle'),
      subtitle: t('profile.emptyRemovedClosedSubtitle'),
      icon: 'shield-outline',
    },
    other_open: {
      title: t('profile.emptyOpenTitle'),
      subtitle: t('profile.emptyOtherOpenSubtitle'),
      icon: 'mail-open-outline',
    },
    other_closed: {
      title: t('profile.emptyClosedTitle'),
      subtitle: t('profile.emptyOtherClosedSubtitleLegacy'),
      icon: 'archive-outline',
    },
  };
  if (isLoading) {
    return <PostGridSkeleton columns={PROFILE_GRID_COLUMNS} count={PROFILE_GRID_COLUMNS * 3} />;
  }
  if (isError && posts.length === 0) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title={t('general.errorTitle')}
        subtitle={t('errorBoundary.body')}
        action={
          onRetry ? (
            <PrimaryButton testID="profile-posts-retry" label={t('general.retry')} size="md" onPress={onRetry} />
          ) : undefined
        }
      />
    );
  }
  if (posts.length === 0) {
    const e = EMPTY_COPY[empty];
    return <EmptyState icon={e.icon} title={e.title} subtitle={e.subtitle} />;
  }
  return (
    <View style={styles.grid}>
      {chunkArray(posts, PROFILE_GRID_COLUMNS).map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((p) => (
            <PostCardGrid
              key={p.postId}
              post={postWithOwnerFromPost(p, postOwner)}
              columns={PROFILE_GRID_COLUMNS}
              gap={spacing.xs}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
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
}));
