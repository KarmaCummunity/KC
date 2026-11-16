// FR-MOD-008 AC2–AC3 — one open entry of the staff review queue, with its actions: open the
// target (or its report case), take the entry, mark it handled.
import React from 'react';
import { View } from 'react-native';
import type { ModerationQueueEntry } from '@kc/application';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { SecondaryButton } from '../../ui/Buttons';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../../lib/rtlLayout';

export type ReviewQueueAction = 'open' | 'take' | 'resolve';

export interface ReviewQueueRowProps {
  readonly entry: ModerationQueueEntry;
  readonly myUserId: string | null;
  readonly busy: boolean;
  readonly onAction: (entry: ModerationQueueEntry, action: ReviewQueueAction) => void;
}

export const ReviewQueueRow = React.memo(function ReviewQueueRow({ entry, myUserId, busy, onAction }: ReviewQueueRowProps) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.reviewQueue;
  const mine = entry.assigneeId !== null && entry.assigneeId === myUserId;
  let assignee: string | null = null;
  if (entry.assigneeId !== null) assignee = mine ? t.assignedToMe : t.assigned;
  return (
    <View style={styles.card} testID={`admin-review-entry-${entry.entryId}`}>
      <Text style={styles.reason}>{`${t.reasons[entry.reason]} · ${t.targets[entry.targetType]}`}</Text>
      <Text style={styles.meta}>{t.openedAt(entry.createdAt.slice(0, 16).replace('T', ' '))}</Text>
      {assignee ? <Text style={styles.assignee}>{assignee}</Text> : null}
      <View style={styles.actions}>
        <SecondaryButton label={t.openCta} size="sm" disabled={busy} onPress={() => onAction(entry, 'open')} />
        {mine ? null : (
          <SecondaryButton label={t.takeCta} size="sm" disabled={busy} onPress={() => onAction(entry, 'take')} />
        )}
        <SecondaryButton label={t.resolveCta} size="sm" disabled={busy} onPress={() => onAction(entry, 'resolve')} />
      </View>
    </View>
  );
});

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reason: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  assignee: { ...typography.caption, color: colors.primary, textAlign: rtlTextAlignStart },
  actions: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
}));
