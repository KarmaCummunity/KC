// app/apps/mobile/src/components/profile/ProfileStatsRow.tsx
// Three counters: followers / following / posts. Tappable when not locked.
// Mapped to: FR-PROFILE-001 AC2, FR-PROFILE-002 AC3, FR-PROFILE-013.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';

export interface ProfileStatsRowProps {
  followersCount: number;
  followingCount: number;
  postsCount: number;
  enabled: boolean;
  onPressFollowers?: () => void;
  onPressFollowing?: () => void;
}

export function ProfileStatsRow({
  followersCount, followingCount, postsCount, enabled,
  onPressFollowers, onPressFollowing,
}: ProfileStatsRowProps) {
  const styles = useProfileStatsRowStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Stat
        count={followersCount}
        label={t('profile.followers')}
        onPress={enabled ? onPressFollowers : undefined}
        styles={styles}
      />
      <View style={styles.divider} />
      <Stat
        count={followingCount}
        label={t('profile.following')}
        onPress={enabled ? onPressFollowing : undefined}
        styles={styles}
      />
      <View style={styles.divider} />
      <Stat count={postsCount} label={t('profile.statsPostsLabel')} styles={styles} />
    </View>
  );
}

function Stat({
  count, label, onPress, styles,
}: {
  count: number;
  label: string;
  onPress?: () => void;
  styles: ReturnType<typeof useProfileStatsRowStyles>;
}) {
  const inner = (
    <View style={styles.stat}>
      <Text style={styles.count}>{count}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} style={styles.statTouch}>{inner}</TouchableOpacity>
  ) : inner;
}

const useProfileStatsRowStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center' as const, gap: spacing.xs },
  statTouch: { flex: 1 },
  divider: { width: 1, height: 32, backgroundColor: colors.border },
  count: { ...typography.h2, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary },
}));
