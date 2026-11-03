// app/apps/mobile/src/components/admin/reports/CaseAuditTimeline.tsx
// FR-ADMIN-013 — chronological list of moderation events on a case.
import { View } from 'react-native';
import type { ReportCaseAuditEntry } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';

export interface CaseAuditTimelineProps {
  readonly entries: readonly ReportCaseAuditEntry[];
}

export function CaseAuditTimeline({ entries }: CaseAuditTimelineProps) {
  const styles = useStyles();
  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>—</Text>
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {entries.map((e) => (
        <View key={e.eventId} style={styles.item}>
          <Text style={styles.action}>{e.action}</Text>
          <Text style={styles.time}>{new Date(e.createdAt).toLocaleString('he-IL')}</Text>
          {e.actorId ? <Text style={styles.actor}>actor: {e.actorId.slice(0, 8)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list:      { gap: spacing.sm },
  item:      { padding: spacing.sm, borderRadius: radius.xs, backgroundColor: colors.skeleton, gap: spacing.xs },
  action:    { fontSize: typography.bodySmall.fontSize, ...typography.semiBold },
  time:      { fontSize: typography.caption.fontSize, opacity: 0.6 },
  actor:     { fontSize: typography.caption.fontSize, opacity: 0.5 },
  empty:     { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: typography.body.fontSize, opacity: 0.5 },
}));
