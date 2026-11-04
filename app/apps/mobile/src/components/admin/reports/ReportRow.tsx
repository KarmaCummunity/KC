// app/apps/mobile/src/components/admin/reports/ReportRow.tsx
// FR-ADMIN-012 — single inbox row showing target preview + threshold + age.
import { memo } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ReportInboxRow } from '@kc/domain';
import { reportSlaState, thresholdProgress } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface ReportRowProps {
  readonly row: ReportInboxRow;
}

function ageLabel(L: LocaleBundle, iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return L.admin.reports.row.ageMinutes(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return L.admin.reports.row.ageHours(hrs);
  const days = Math.floor(hrs / 24);
  return L.admin.reports.row.ageDays(days);
}

function preview(row: ReportInboxRow): string {
  const t = row.target;
  if (typeof t['preview'] === 'string') return t['preview'];
  if (typeof t['display_name'] === 'string') return t['display_name'];
  return `${row.targetType}:${row.targetId.slice(0, 8)}`;
}

function ReportRowInner({ row }: ReportRowProps) {
  const progress = thresholdProgress(row.reporterCount);
  const caseId = encodeURIComponent(`${row.targetType}:${row.targetId}`);
  const styles = useStyles();
  const L = useLocaleBundle();
  const sla = reportSlaState(row.oldestAt);
  return (
    <Pressable
      style={styles.root}
      onPress={() =>
        router.push({
          pathname: '/(admin)/reports/[caseId]',
          params: { caseId },
        })
      }
    >
      <Text style={styles.preview} numberOfLines={2}>{preview(row)}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {L.admin.reports.row.thresholdLabel(progress.count, progress.threshold)}
        </Text>
        <Text style={styles.metaText}>{ageLabel(L, row.oldestAt)}</Text>
        {sla !== 'on_track' ? (
          <View
            testID={`report-sla-badge-${sla}`}
            style={sla === 'overdue' ? styles.badgeOverdue : styles.badgeWarning}
          >
            <Text style={sla === 'overdue' ? styles.badgeOverdueText : styles.badgeWarningText}>
              {sla === 'overdue' ? L.admin.reports.row.slaOverdue : L.admin.reports.row.slaWarning}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export const ReportRow = memo(ReportRowInner);

const useStyles = makeUseStyles(({ colors }) => ({
  root:      { padding: spacing.base, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  preview:   { fontSize: typography.body.fontSize, ...typography.medium },
  meta:      { flexDirection: 'row', gap: spacing.md },
  metaText:  { fontSize: typography.bodySmall.fontSize, opacity: 0.6 },
  badgeWarning:     { paddingHorizontal: spacing.sm, borderRadius: radius.full, backgroundColor: colors.warningLight },
  badgeWarningText: { fontSize: typography.bodySmall.fontSize, ...typography.medium, color: colors.textPrimary },
  badgeOverdue:     { paddingHorizontal: spacing.sm, borderRadius: radius.full, backgroundColor: colors.errorLight },
  badgeOverdueText: { fontSize: typography.bodySmall.fontSize, ...typography.medium, color: colors.error },
}));
