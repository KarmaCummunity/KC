// app/apps/mobile/src/components/profile/ProfileHeader.tsx
// Shared profile header — avatar + display name + privacy lock + bio.
// Used by My Profile tab routes and user/[handle]/index.tsx.
// Mapped to: FR-PROFILE-001 AC1, FR-PROFILE-002 AC1, FR-PROFILE-011, 012.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, spacing, typography, useTheme, Text } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';
import { isOpaqueSystemShareHandle } from '../../lib/shareHandleDisplay';
import { rowDirectionStart } from '../../lib/rtlLayout';

export interface ProfileHeaderProps {
  displayName: string;
  handle?: string | null;
  /** City only; profile street/number is not shown on headers. */
  locationLine?: string | null;
  avatarUrl: string | null;
  biography: string | null;
  privacyMode: 'Public' | 'Private';
  onLockPress?: () => void;
  size?: number;
}

export function ProfileHeader({
  displayName, handle, locationLine, avatarUrl, biography, privacyMode, onLockPress, size = 96,
}: ProfileHeaderProps) {
  const styles = useProfileHeaderStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const showLock = privacyMode === 'Private';
  return (
    <View style={styles.wrap}>
      <AvatarInitials name={displayName} avatarUrl={avatarUrl} size={size} />
      <View style={styles.nameRow}>
        <Text style={styles.displayName}>{displayName}</Text>
        {showLock ? (
          <TouchableOpacity onPress={onLockPress} accessibilityLabel={t('profile.privateProfileA11y')}>
            <Ionicons
              name="lock-closed"
              size={iconSize.md}
              color={colors.textSecondary}
              style={styles.lock}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {handle && !isOpaqueSystemShareHandle(handle) ? (
        <Text style={styles.handle}>@{handle}</Text>
      ) : null}
      {locationLine ? <Text style={styles.location}>{locationLine}</Text> : null}
      {biography ? <Text style={styles.bio}>{biography}</Text> : null}
    </View>
  );
}

const useProfileHeaderStyles = makeUseStyles(({ colors }) => ({
  wrap: { alignItems: 'center' as const, gap: spacing.xs, paddingVertical: spacing.sm },
  nameRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  displayName: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' as const },
  lock: { marginTop: spacing.xs },
  handle: { ...typography.body, color: colors.textSecondary },
  location: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const },
  bio: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center' as const,
    paddingHorizontal: spacing.md,
  },
}));
