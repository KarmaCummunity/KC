// FeedEmptyState — warm empty state for the Home Feed (FR-FEED-008).
// CTAs adapt to whether filters caused the emptiness; a link to feed settings
// helps when muted words / categories / people may be hiding posts.

import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { FeedCommunityCounter } from './FeedCommunityCounter';
import { EmptyStateActions } from './EmptyState';

interface FeedEmptyStateProps {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onShare: () => void;
  /** Shown as a text link under the buttons when provided. */
  onOpenFeedSettings?: () => void;
}

export function FeedEmptyState({
  hasActiveFilters,
  onClearFilters,
  onShare,
  onOpenFeedSettings,
}: FeedEmptyStateProps) {
  const styles = useFeedEmptyStateStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.wrap} testID="feed-empty-state">
      <Ionicons name="archive-outline" size={56} color={colors.textDisabled} />
      <Text style={styles.title}>
        {hasActiveFilters ? t('feed.emptyFiltered') : t('feed.empty')}
      </Text>
      <Text style={styles.body}>
        {hasActiveFilters ? t('feed.emptyFilteredDesc') : t('feed.emptyDesc')}
      </Text>
      <FeedCommunityCounter
        template={(n) => t('feed.activeInCommunityWithCount', { count: n })}
      />
      <View style={styles.actions}>
        <EmptyStateActions
          primary={{ label: t('feed.sharePost'), onPress: onShare }}
          secondary={hasActiveFilters ? { label: t('feed.clearFilters'), onPress: onClearFilters } : undefined}
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
  link: { ...typography.body, color: colors.primary, fontWeight: '600' as const, marginTop: spacing.sm },
}));
