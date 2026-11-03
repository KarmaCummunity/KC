// NewPostsBanner — sticky "↑ N new posts" pill above the feed. Tap to
// refresh + scroll to top. Mapped to FR-FEED-009 AC2 (no silent injection
// into the user's scroll position).

import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, iconSize, shadow, useTheme, Text } from '@kc/ui';

interface NewPostsBannerProps {
  count: number;
  onPress: () => void;
}

export function NewPostsBanner({ count, onPress }: NewPostsBannerProps) {
  const styles = useNewPostsBannerStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (count <= 0) return null;
  const label = count === 1 ? t('feed.newPostsOne') : t('feed.newPostsMany', { count });
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.pill} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        <Ionicons name="arrow-up" size={iconSize.sm} color={colors.textInverse} />
        <Text style={styles.text}>{label}</Text>
      </Pressable>
    </View>
  );
}

const useNewPostsBannerStyles = makeUseStyles(({ colors, isDark }) => ({
  wrap: { alignItems: 'center' as const, paddingVertical: spacing.sm },
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    ...shadow.glow,
    shadowColor: colors.primary,
    shadowOpacity: isDark ? 0 : shadow.glow.shadowOpacity,
    elevation: isDark ? 0 : shadow.glow.elevation,
  },
  text: { ...typography.caption, color: colors.textInverse, ...typography.bold },
}));
