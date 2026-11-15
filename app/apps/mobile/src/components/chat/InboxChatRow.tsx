// Single inbox row — FR-CHAT-001, FR-CHAT-016.
import React from 'react';
import { View, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { ChatWithPreview } from '@kc/application';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';
import { OnlineDot } from './OnlineDot';
import { formatRelativeChatTime } from '../../lib/formatRelativeChatTime';
import { formatInboxPreview, inboxMediaIcon } from '../../lib/formatInboxPreview';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { VerificationBadge } from '../VerificationBadge';
interface Props {
  readonly item: ChatWithPreview;
  readonly onOpen: (chatId: string) => void;
  readonly onRequestHide: (chatId: string, otherUserId: string | null) => void;
}

const ELLIPSIS_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// Memoized: the inbox KcFlashList re-renders on every search keystroke and
// refresh, but each row only depends on its own `item` and stable parent
// callbacks — without memo every row re-rendered on each keystroke.
function InboxChatRowInner({ item, onOpen, onRequestHide }: Props) {
  const { t } = useTranslation();
  const styles = useInboxChatRowStyles();
  const { colors } = useTheme();
  // Some inbox rows (support/system chats, deleted peers) arrive without a
  // participant; never dereference it blindly.
  const other = item.otherParticipant;
  // A support thread has no counterpart to name: it carries the support title instead.
  const otherName =
    other?.displayName ?? (item.isSupportThread ? t('chat.messaging.supportThreadTitle') : t('common.deletedUser'));
  const mediaIcon = inboxMediaIcon(item.lastMessage);
  return (
    <View style={styles.chatRow}>
      <TouchableOpacity style={styles.chatRowMain} onPress={() => onOpen(item.chatId)}>
        <View>
          <AvatarInitials
            name={otherName}
            avatarUrl={other?.avatarUrl ?? null}
            size={48}
          />
          <OnlineDot userId={!other || other.isDeleted ? null : other.userId} />
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTime}>
              {formatRelativeChatTime(item.lastMessage?.createdAt ?? item.lastMessageAt)}
            </Text>
            <View style={styles.chatNameRow}>
              <Text style={styles.chatName}>{otherName}</Text>
              <VerificationBadge level={other?.verificationLevel} />
            </View>
          </View>
          <View style={styles.previewRow}>
            {mediaIcon ? <Ionicons name={mediaIcon} size={iconSize.sm} color={colors.textSecondary} /> : null}
            <Text style={styles.chatPreview} numberOfLines={1}>
              {formatInboxPreview(item.lastMessage, t)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
      {item.unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {item.unreadCount > 9 ? '9+' : String(item.unreadCount)}
          </Text>
        </View>
      ) : (
        <View style={{ width: 22 }} />
      )}
      <Pressable
        onPress={() => onRequestHide(item.chatId, other?.userId ?? null)}
        hitSlop={ELLIPSIS_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={t('chat.hideChatA11y')}
        android_ripple={null}
        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="ellipsis-horizontal" size={iconSize.xl} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export const InboxChatRow = React.memo(InboxChatRowInner);

const useInboxChatRowStyles = makeUseStyles(({ colors }) => ({
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  chatRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  chatInfo: { flex: 1, gap: spacing.xs },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatNameRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  chatName: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  chatTime: { ...typography.caption, color: colors.textSecondary },
  previewRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  chatPreview: { flexShrink: 1, ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  badge: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: { ...typography.caption, color: colors.textInverse, ...typography.semiBold },
}));

export function InboxChatRowSeparator() {
  const styles = useInboxChatRowSeparatorStyles();
  return <View style={styles.line} />;
}

const useInboxChatRowSeparatorStyles = makeUseStyles(({ colors }) => ({
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginEnd: spacing.base },
}));
