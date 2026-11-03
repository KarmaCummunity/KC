import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, Text } from '@kc/ui';
import type { User } from '@kc/domain';
import { AvatarInitials } from '../AvatarInitials';
import type { useFollowListStyles } from '../../screens/followList.styles';

export interface FollowUserRowProps {
  readonly user: User;
  readonly fallbackName: string;
  readonly cityNotSet: string;
  readonly isMe?: boolean;
  readonly onOpen: (handle: string) => void;
  readonly onRemove?: (user: User) => void;
  readonly styles: ReturnType<typeof useFollowListStyles>;
  readonly textColorSecondary: string;
}

function FollowUserRowInner({
  user,
  fallbackName,
  cityNotSet,
  isMe,
  onOpen,
  onRemove,
  styles,
  textColorSecondary,
}: FollowUserRowProps) {
  const handlePress = React.useCallback(() => {
    onOpen(user.shareHandle);
  }, [user.shareHandle, onOpen]);

  const handleRemove = React.useCallback(() => {
    if (onRemove) onRemove(user);
  }, [user, onRemove]);

  return (
    <TouchableOpacity style={styles.row} onPress={handlePress} testID={`follow-user-${user.userId}`}>
      <AvatarInitials name={user.displayName ?? fallbackName} avatarUrl={user.avatarUrl} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.name}>{user.displayName ?? fallbackName}</Text>
        <Text style={styles.city}>{user.cityName ?? cityNotSet}</Text>
      </View>
      {isMe && onRemove ? (
        <TouchableOpacity onPress={handleRemove} style={styles.menuBtn} testID={`remove-follower-${user.userId}`}>
          <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={textColorSecondary} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export const FollowUserRow = React.memo(FollowUserRowInner);
