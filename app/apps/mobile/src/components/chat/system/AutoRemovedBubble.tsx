// FR-ADMIN-002 / FR-ADMIN-004 / FR-MOD-005 AC3 — admin-facing bubble for
// auto-removed targets. Shows restore + (for user targets) ban actions to
// super admins, plus a rich preview card when the enriched payload
// (link_target + target_preview) is present.
import React from 'react';
import { View, Pressable } from 'react-native';
import { makeUseStyles, spacing, radius, typography, useTheme, Text } from '@kc/ui';
import { hasPermission, type AdminRole } from '@kc/domain';
import { useAdminRoles } from '../../../hooks/useAdminRoles';
import { useAuthStore } from '../../../store/authStore';
import { container } from '../../../lib/container';
import { useTranslation } from 'react-i18next';
import { confirmAndRun, showAdminToast } from './adminActions';
import { readLinkTarget, readPreview, TargetPreviewCard } from './targetPreviewCard';
import type { SystemMessageBubbleProps } from './SystemMessageBubble';
import { rowDirectionStart } from '../../../lib/rtlLayout';

type TargetType = 'post' | 'user' | 'chat';

export function AutoRemovedBubble({
  payload,
  body,
  handledByLaterAction,
}: SystemMessageBubbleProps) {
  const { roles } = useAdminRoles();
  const canViewReports = hasPermission(roles as readonly AdminRole[], 'reports.view');
  const me = useAuthStore((s) => s.session?.userId ?? null);
  const styles = useAutoRemovedBubbleStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const targetType = payload?.target_type as TargetType | undefined;
  const targetId = payload?.target_id as string | undefined;
  const showActions = canViewReports && !handledByLaterAction && !!targetType && !!targetId;

  const linkTarget = readLinkTarget(payload);
  const preview = readPreview(payload);
  const showRichPreview = canViewReports && !!linkTarget && !!preview;
  const showChatNote = showRichPreview && targetType === 'chat';

  return (
    <View style={[styles.bubble, handledByLaterAction && styles.dimmed]}>
      <Text style={styles.title}>{t('moderation.bubble.autoRemoved.title')}</Text>
      {showChatNote ? <Text style={styles.note}>{t('moderation.bubble.targetPreview.chatNote')}</Text> : null}

      {showRichPreview && linkTarget && preview ? (
        <TargetPreviewCard linkTarget={linkTarget} preview={preview} borderColor={colors.warning} />
      ) : null}

      {showRichPreview ? <Text style={styles.evidence}>{t('moderation.bubble.targetPreview.evidenceLabel')}</Text> : null}

      {body.length > 0 ? <Text style={styles.body}>{body}</Text> : null}

      {showActions ? (
        <View style={styles.row}>
          <Pressable
            onPress={() =>
              confirmAndRun({
                action: 'restore',
                onConfirm: () =>
                  container.restoreTarget.execute({
                    targetType: targetType!,
                    targetId: targetId!,
                  }),
                onSuccess: () => showAdminToast(t('moderation.actions.success.restore')),
                onError: showAdminToast,
              })
            }
          >
            <Text style={styles.btn}>{t('moderation.actions.restore')}</Text>
          </Pressable>
          {targetType === 'user' && me ? (
            <Pressable
              onPress={() =>
                confirmAndRun({
                  action: 'ban',
                  onConfirm: () =>
                    container.banUser.execute({
                      adminId: me,
                      targetUserId: targetId!,
                      reason: 'policy_violation',
                      note: 'auto-removed at threshold',
                    }),
                  onSuccess: () => showAdminToast(t('moderation.actions.success.ban')),
                  onError: showAdminToast,
                })
              }
            >
              <Text style={styles.btn}>{t('moderation.actions.ban')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useAutoRemovedBubbleStyles = makeUseStyles(({ colors }) => ({
  bubble: {
    padding: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
    marginVertical: spacing.xs,
    alignSelf: 'center' as const,
    maxWidth: '90%',
  },
  dimmed: { opacity: 0.5 },
  title: { ...typography.semiBold, color: colors.textPrimary },
  body: { marginTop: spacing.xs, ...typography.body, color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' as const, marginTop: spacing.xs },
  evidence: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' as const, marginTop: spacing.xs },
  row: { flexDirection: rowDirectionStart, gap: spacing.base, marginTop: spacing.sm },
  btn: { color: colors.secondary, ...typography.semiBold },
}));
