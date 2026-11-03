// app/apps/mobile/src/components/admin/surveys/FeedbackCard.tsx
// FR-ADMIN-021 — one free-text feedback entry (FR-SETTINGS-017).
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { AdminFeedbackEntry } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { textAlignStart, rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function FeedbackCard({ entry }: { entry: AdminFeedbackEntry }): ReactElement {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.surveys.feedback;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.displayName ?? t.anonymous}
        </Text>
        {entry.rating != null ? (
          <View style={styles.ratingPill}>
            <Text style={styles.ratingText}>{entry.rating}/7</Text>
          </View>
        ) : (
          <Text style={styles.noRating}>{t.noRating}</Text>
        )}
      </View>
      <Text style={styles.body}>{entry.body}</Text>
      <Text style={styles.meta}>{fmt(entry.createdAt)}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: typography.body.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  ratingPill: {
    backgroundColor: colors.primarySurface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ratingText: { fontSize: typography.bodySmall.fontSize, ...typography.extraBold, color: colors.primaryDark },
  noRating: { fontSize: typography.caption.fontSize, color: colors.textDisabled },
  body: { fontSize: typography.body.fontSize, color: colors.textPrimary, textAlign: textAlignStart(), lineHeight: 20 },
  meta: { fontSize: typography.caption.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
}));
