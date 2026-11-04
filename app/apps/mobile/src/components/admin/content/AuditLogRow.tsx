// app/apps/mobile/src/components/admin/content/AuditLogRow.tsx
// FR-ADMIN-020 — single row in the admin audit log viewer.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AdminAuditRow } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface AuditLogRowProps {
  readonly row: AdminAuditRow;
}

function fmtTs(d: Date): string {
  return d.toLocaleString('he-IL', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function AuditLogRowInner({ row }: AuditLogRowProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.action}>
          {L.admin.content.auditAction[row.action as keyof LocaleBundle['admin']['content']['auditAction']]
            ?? row.action}
        </Text>
        <Text style={styles.ts}>{fmtTs(row.createdAt)}</Text>
      </View>
      <Text style={styles.actor}>
        {row.actorDisplayName ?? L.admin.content.systemActor}
        {row.targetDisplayName && ` → ${row.targetDisplayName}`}
      </Text>
      {Object.keys(row.metadata).length > 0 && (
        <Text style={styles.meta} numberOfLines={2}>
          {JSON.stringify(row.metadata)}
        </Text>
      )}
    </View>
  );
}

export const AuditLogRow = memo(AuditLogRowInner);

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.base, gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  action:    { ...typography.bodySmall, ...typography.bold, color: colors.primary },
  ts:        { ...typography.caption, color: colors.textSecondary },
  actor:     { ...typography.caption, color: colors.textPrimary },
  meta:      { ...typography.caption, color: colors.textSecondary },
}));
