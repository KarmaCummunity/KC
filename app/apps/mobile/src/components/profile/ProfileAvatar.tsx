// Profile header avatar. With `onIncompletePress` (own profile below level 1) it shows an
// accent dot and opens Edit profile on tap (FR-VERIFY-013 AC1).
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';

const DOT_SIZE = 16;

export interface ProfileAvatarProps {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly size: number;
  readonly onIncompletePress?: () => void;
}

export function ProfileAvatar({ name, avatarUrl, size, onIncompletePress }: ProfileAvatarProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const avatar = <AvatarInitials name={name} avatarUrl={avatarUrl} size={size} />;
  if (!onIncompletePress) return avatar;
  return (
    <TouchableOpacity
      onPress={onIncompletePress}
      accessibilityRole="button"
      accessibilityLabel={t('verification.nudge.avatarDot')}
      testID="profile-avatar-incomplete"
    >
      {avatar}
      <View style={styles.dot} />
    </TouchableOpacity>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  dot: {
    position: 'absolute' as const,
    top: 2,
    end: 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
}));
