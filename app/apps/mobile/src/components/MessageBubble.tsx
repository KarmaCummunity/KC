// Bubble for a single chat message — FR-CHAT-002 AC2/AC4.
// FR-ADMIN-005 — admins can long-press a user-kind bubble to hard-delete it.
import React, { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import type { MessageReactionType } from '@kc/infrastructure-supabase';
import { Ionicons } from '@expo/vector-icons';
import type { OptimisticMessage } from '../store/chatStore';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { SystemMessageBubble } from './chat/system/SystemMessageBubble';
import { hasPermission, type AdminRole } from '@kc/domain';
import { useAdminRoles } from '../hooks/useAdminRoles';
import { container } from '../lib/container';
import { confirmAndRun, showAdminToast } from './chat/system/adminActions';
import { formatMessageBubbleTime } from '../lib/chatMessageDisplayTime';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { useTranslation } from 'react-i18next';
import { ChatMediaImage } from './chat/ChatMediaImage';
import { chatImagePath } from '../services/chatMediaUrl';
import { ChatReactionChips } from './chat/ChatReactionChips';
import type { ReactionSummary } from '../hooks/useChatMessageReactions';
import { systemMessageText } from '../lib/chat/systemMessageText';

const KNOWN_MOD_KINDS = [
  'report_received',
  'auto_removed',
  'mod_action_taken',
  'owner_auto_removed',
  'donation_link_reported',
  'support_issue',
] as const;

function MessageBubbleInner({
  m, mine, onRetry, handledByLaterAction, reactionSummary, myReaction, onReactionPick,
}: {
  m: OptimisticMessage;
  mine: boolean;
  /** Receives the message identity so the parent can pass a stable callback. */
  onRetry: (clientId: string, body: string) => void;
  handledByLaterAction?: boolean;
  reactionSummary?: ReactionSummary;
  myReaction?: MessageReactionType | null;
  /** Called with the persisted message id; reactions are off for unsent messages. */
  onReactionPick?: (messageId: string, reaction: MessageReactionType) => void;
}) {
  const [showTime, setShowTime] = useState(false);
  const { t } = useTranslation();
  const { roles } = useAdminRoles();
  const canDeleteMessage = hasPermission(roles as readonly AdminRole[], 'chat.delete_message');
  const styles = useMessageBubbleStyles();
  const { colors } = useTheme();
  const mineMetaColor = { color: colors.textInverse, opacity: 0.7 };

  const handlePickReaction = React.useMemo(
    () =>
      onReactionPick && m.messageId
        ? (reaction: MessageReactionType) => onReactionPick(m.messageId!, reaction)
        : undefined,
    [m.messageId, onReactionPick],
  );

  // System messages (FR-CHAT-007 / FR-MOD-002) — moderation kinds delegate to
  // SystemMessageBubble; unknown/legacy kinds keep the existing neutral pill.
  if (m.kind === 'media') {
    const imagePath = chatImagePath(m.mediaPayload);
    return (
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        {imagePath ? <ChatMediaImage path={imagePath} style={styles.mediaImage} /> : null}
        {m.body.trim().length > 0 && m.body.trim() !== ' ' ? (
          <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {m.body}
          </Text>
        ) : null}
        {handlePickReaction ? (
          <ChatReactionChips
            summary={reactionSummary ?? {}}
            mine={myReaction ?? null}
            onPick={handlePickReaction}
          />
        ) : null}
      </View>
    );
  }

  if (m.kind === 'system') {
    const kind = (m.systemPayload as { kind?: string } | null)?.kind;
    if (kind && (KNOWN_MOD_KINDS as readonly string[]).includes(kind)) {
      return (
        <SystemMessageBubble
          messageId={m.messageId}
          payload={m.systemPayload}
          body={m.body}
          createdAt={m.createdAt}
          handledByLaterAction={handledByLaterAction ?? false}
        />
      );
    }
    return (
      <View style={styles.systemWrap}>
        <View style={styles.systemPill}>
          <Ionicons name="information-circle-outline" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.systemText}>{systemMessageText(m, t)}</Text>
        </View>
      </View>
    );
  }

  // FR-ADMIN-005 AC2 — admin hard-delete via long-press; deletion propagates
  // through Realtime DELETE events, so the bubble disappears on its own.
  const onAdminLongPress = canDeleteMessage && m.messageId
    ? () => {
        const messageId = m.messageId!;
        confirmAndRun({
          action: 'deleteMessage',
          onConfirm: () => container.deleteMessage.execute({ messageId }),
          onSuccess: () => showAdminToast(t('moderation.actions.success.deleteMessage')),
          onError: showAdminToast,
        });
      }
    : undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => setShowTime((s) => !s)}
      onLongPress={onAdminLongPress}
      delayLongPress={400}
    >
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>{m.body}</Text>
        {handlePickReaction ? (
          <ChatReactionChips
            summary={reactionSummary ?? {}}
            mine={myReaction ?? null}
            onPick={handlePickReaction}
          />
        ) : null}
        <View style={styles.bubbleMeta}>
          {m.failed && (
            <TouchableOpacity onPress={() => onRetry(m.clientId, m.body)}><Ionicons name="refresh" size={iconSize.xs} color={colors.textInverse} /></TouchableOpacity>
          )}
          {mine && !m.failed && <Text style={[styles.readReceipt, mineMetaColor]}>{m.status === 'read' ? '✓✓' : '✓'}</Text>}
          {showTime && (
            <Text style={[styles.timeText, mine ? mineMetaColor : null]}>
              {formatMessageBubbleTime(m.createdAt)}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Memoized: the thread re-renders on every composer keystroke; without memo
// every bubble re-rendered on each keystroke. Props are the message ref
// (stable unless the message changes), two booleans, and a stable onRetry.
export const MessageBubble = React.memo(MessageBubbleInner);

const useMessageBubbleStyles = makeUseStyles(({ colors }) => ({
  bubble: { maxWidth: '80%', padding: spacing.md, borderRadius: radius.lg, gap: spacing.xs },
  // Tail-notch corner uses logical start/end radii so web (RN-Web maps these to
  // CSS border-*-*-radius) and native (RN ≥ 0.71) mirror identically under RTL —
  // physical Left/Right diverged between the two platforms (TD-159).
  bubbleMine: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderBottomStartRadius: radius.xs },
  bubbleOther: { alignSelf: 'flex-end', backgroundColor: colors.surface, borderBottomEndRadius: radius.xs, borderWidth: 1, borderColor: colors.border },
  bubbleText: { ...typography.body },
  bubbleTextMine: { color: colors.textInverse },
  bubbleTextOther: { color: colors.textPrimary, textAlign: rtlTextAlignStart },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  timeText: { ...typography.caption, color: colors.textSecondary },
  readReceipt: { fontSize: typography.caption.fontSize },
  systemWrap: { alignItems: 'center', paddingVertical: spacing.xs },
  systemPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full,
    maxWidth: '90%',
  },
  systemText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  mediaImage: { width: 220, height: 220, borderRadius: radius.md, backgroundColor: colors.background },
}));
