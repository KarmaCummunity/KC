// V2-ADMIN-TIME-10 — single timesheet entry row.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { timesheetActions, type TimesheetEntry } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { DangerButton, PrimaryButton, SecondaryButton } from '../../ui/Buttons';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface TimesheetEntryCardProps {
  readonly entry: TimesheetEntry;
  readonly isMine: boolean;
  readonly canApprove: boolean;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
  readonly onSubmit?: () => void;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
}

function fmtIso(s: string): string { return s.slice(0, 10); }

function TimesheetEntryCardInner(props: TimesheetEntryCardProps) {
  const { entry, isMine, canApprove } = props;
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.time;
  const hours = entry.hoursX100 / 100;
  // The buttons follow `timesheetMachine`, the same graph the timesheet RPCs enforce.
  const can = timesheetActions(entry.status, { isMine, canApprove });
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.workDate}>{fmtIso(entry.workDate)}</Text>
        <View style={styles.headRight}>
          <View style={styles.hoursChip}><Text style={styles.hoursChipText}>{t.row.hoursLabel(hours)}</Text></View>
          <View style={[styles.statusChip, styles[`status_${entry.status}` as const]]}>
            <Text style={styles.statusChipText}>{t.status[entry.status]}</Text>
          </View>
        </View>
      </View>
      {!isMine && entry.userName && (
        <Text style={styles.meta}>{t.row.reportedBy(entry.userName)}</Text>
      )}
      {entry.project && <Text style={styles.meta}>{t.row.project} {entry.project}</Text>}
      {entry.description && <Text style={styles.description} numberOfLines={3}>{entry.description}</Text>}
      {entry.submittedAt && (
        <Text style={styles.metaSubtle}>{t.row.submittedAt(entry.submittedAt.toLocaleDateString('he-IL'))}</Text>
      )}
      {entry.approvedAt && entry.approverName && (
        <Text style={styles.metaSubtle}>
          {entry.status === 'approved'
            ? t.row.approvedBy(entry.approverName)
            : t.row.rejectedBy(entry.approverName)}
          {entry.approvalNote ? ` · ${entry.approvalNote}` : ''}
        </Text>
      )}

      {/* Compact admin size (spec 17 §4.3); delete and reject are destructive, so DangerButtons (D94). */}
      <View style={styles.actions}>
        {/* A rejected entry moves on only through an edit, so there it is the primary action. */}
        {can.edit && props.onEdit && (
          entry.status === 'rejected'
            ? <PrimaryButton label={t.row.edit} size="sm" onPress={props.onEdit} />
            : <SecondaryButton label={t.row.edit} size="sm" onPress={props.onEdit} />
        )}
        {can.submit && props.onSubmit && (
          <PrimaryButton label={t.row.submit} size="sm" onPress={props.onSubmit} />
        )}
        {can.delete && props.onDelete && (
          <DangerButton label={t.row.delete} size="sm" onPress={props.onDelete} />
        )}
        {can.decide && props.onReject && (
          <DangerButton label={t.row.reject} size="sm" onPress={props.onReject} />
        )}
        {can.decide && props.onApprove && (
          <PrimaryButton label={t.row.approve} size="sm" onPress={props.onApprove} />
        )}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    margin: spacing.md, padding: spacing.md, gap: spacing.xs,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  head:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workDate:    { fontSize: typography.body.fontSize, ...typography.bold },
  headRight:   { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hoursChip:   { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.xs, backgroundColor: colors.primarySurface },
  hoursChipText: { fontSize: typography.caption.fontSize, ...typography.bold, color: colors.primary },
  statusChip:  { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.xs },
  status_draft:     { backgroundColor: colors.secondaryLight },
  status_submitted: { backgroundColor: colors.warningLight },
  status_approved:  { backgroundColor: colors.successLight },
  status_rejected:  { backgroundColor: colors.errorLight },
  statusChipText:   { fontSize: typography.caption.fontSize, ...typography.bold },
  meta:        { fontSize: typography.bodySmall.fontSize, opacity: 0.7 },
  metaSubtle:  { fontSize: typography.caption.fontSize, opacity: 0.6, marginTop: spacing.xs },
  description: { fontSize: typography.bodySmall.fontSize, marginTop: spacing.xs, opacity: 0.85 },
  actions:     { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, justifyContent: 'flex-end' },
}));

export const TimesheetEntryCard = memo(TimesheetEntryCardInner);
