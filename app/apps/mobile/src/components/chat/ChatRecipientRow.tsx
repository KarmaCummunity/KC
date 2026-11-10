// One person in the "new conversation" picker — FR-CHAT-017.
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { User } from '@kc/domain';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  readonly user: User;
  readonly disabled: boolean;
  readonly onPick: (user: User) => void;
}

function ChatRecipientRowInner({ user, disabled, onPick }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const name = user.displayName ?? t('profile.fallbackName');
  return (
    <TouchableOpacity
      style={styles.row}
      disabled={disabled}
      onPress={() => onPick(user)}
      accessibilityRole="button"
      accessibilityLabel={t('chat.new.pickA11y', { name })}
      testID={`chat-recipient-${user.userId}`}
    >
      <AvatarInitials name={name} avatarUrl={user.avatarUrl} size={44} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
    </TouchableOpacity>
  );
}

export const ChatRecipientRow = React.memo(ChatRecipientRowInner);

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.surface,
  },
  name: {
    flex: 1,
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
}));
