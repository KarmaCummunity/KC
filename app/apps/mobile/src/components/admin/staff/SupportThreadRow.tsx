// FR-CHAT-007 / FR-MOD-002 — one member's support thread in the staff support inbox.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import type { SupportThreadSummary } from '@kc/application';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { AvatarInitials } from '../../AvatarInitials';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

export interface SupportThreadRowProps {
  readonly thread: SupportThreadSummary;
  readonly busy: boolean;
  readonly onOpen: (thread: SupportThreadSummary) => void;
}

export const SupportThreadRow = React.memo(function SupportThreadRow({ thread, busy, onOpen }: SupportThreadRowProps) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.supportInbox;
  const name = thread.memberDisplayName ?? t.unnamedMember;
  return (
    <TouchableOpacity
      style={styles.row}
      disabled={busy}
      onPress={() => onOpen(thread)}
      accessibilityRole="button"
      accessibilityLabel={`${t.openCta}: ${name}`}
      testID={`admin-support-thread-${thread.chatId}`}
    >
      <AvatarInitials name={name} avatarUrl={thread.memberAvatarUrl} size={40} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta}>{t.lastMessage(thread.lastMessageAt.slice(0, 16).replace('T', ' '))}</Text>
      </View>
      {thread.joined ? <Text style={styles.badge}>{t.joined}</Text> : null}
    </TouchableOpacity>
  );
});

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  body: { flex: 1, gap: spacing.xs },
  name: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  badge: { ...typography.caption, color: colors.primary },
}));
