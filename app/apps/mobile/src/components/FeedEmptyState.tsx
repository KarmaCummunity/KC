// FeedEmptyState — warm empty state for the Home Feed (FR-FEED-008).
// Sheet filters (filterStore) and mutes (feed settings) are separate; both can empty the feed.

import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { FeedCommunityCounter } from './FeedCommunityCounter';
import { EmptyStateActions } from './EmptyState';

interface FeedEmptyStateProps {
  hasSheetFilters: boolean;
  hasMutes: boolean;
  onClearFilters: () => void;
  onShare: () => void;
  onOpenFeedSettings?: () => void;
}

export function FeedEmptyState({
  hasSheetFilters,
  hasMutes,
  onClearFilters,
  onShare,
  onOpenFeedSettings,
}: FeedEmptyStateProps) {
  const styles = useFeedEmptyStateStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const titleKey = hasSheetFilters
    ? 'feed.emptyFiltered'
    : hasMutes
      ? 'feed.emptyMuted'
      : 'feed.empty';
  const bodyKey = hasSheetFilters
    ? hasMutes
      ? 'feed.emptyFilteredAndMutedDesc'
      : 'feed.emptyFilteredDesc'
    : hasMutes
      ? 'feed.emptyMutedDesc'
      : 'feed.emptyDesc';
  const showCommunityHint = hasSheetFilters || hasMutes;
  const communityTemplate = hasMutes && !hasSheetFilters
    ? (n: number) => t('feed.activeInCommunityMaybeHidden', { count: n })
    : (n: number) => t('feed.activeInCommunityWithCount', { count: n });

  return (
    <View style={styles.wrap} testID="feed-empty-state">
      <Ionicons
        name="archive-outline"
        size={56} // brand-guard-allow: empty-state illustration, above the icon scale
        color={colors.textDisabled}
      />
      <Text style={styles.title}>{t(titleKey)}</Text>
      <Text style={styles.body}>{t(bodyKey)}</Text>
      {showCommunityHint ? <FeedCommunityCounter template={communityTemplate} /> : null}
      <View style={styles.actions}>
        <EmptyStateActions
          primary={{ label: t('feed.sharePost'), onPress: onShare }}
          secondary={
            hasSheetFilters ? { label: t('feed.clearFilters'), onPress: onClearFilters } : undefined
          }
        />
      </View>
      {onOpenFeedSettings ? (
        <Pressable onPress={onOpenFeedSettings} accessibilityRole="link" hitSlop={8} testID="feed-empty-settings">
          <Text style={styles.link}>{t('emptyStates.feedOpenSettings')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useFeedEmptyStateStyles = makeUseStyles(({ colors }) => ({
  wrap: { alignItems: 'center' as const, justifyContent: 'center' as const, padding: spacing.xl, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: spacing.sm,
  },
  actions: { marginTop: spacing.base },
  link: { ...typography.body, ...typography.semiBold, color: colors.primary, marginTop: spacing.sm },
}));
