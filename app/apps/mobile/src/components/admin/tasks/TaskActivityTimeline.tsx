// app/apps/mobile/src/components/admin/tasks/TaskActivityTimeline.tsx
// FR-ADMIN-018 — activity timeline (comments + status/assignment/priority/due changes).
import { StyleSheet, View } from 'react-native';
import {
  type AdminTaskActivity, type AdminTaskActivityKind, type AdminTaskCategory,
  parseAdminTaskCategory,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

function categoryLabel(value: unknown, L: LocaleBundle): string {
  if (typeof value !== 'string') return '';
  const parsed = parseAdminTaskCategory(value);
  return parsed ? L.admin.tasks.category[parsed as AdminTaskCategory] : value;
}

export interface TaskActivityTimelineProps {
  readonly activities: readonly AdminTaskActivity[];
}

function fmtTs(d: Date): string {
  return d.toLocaleString('he-IL', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function describe(activity: AdminTaskActivity, L: LocaleBundle): string {
  const p = (activity.payload ?? {}) as Record<string, unknown>;
  const k = activity.kind as AdminTaskActivityKind;
  switch (k) {
    case 'created':
      return L.admin.tasks.timeline.created;
    case 'comment':
      return typeof p['body'] === 'string' ? (p['body'] as string) : '';
    case 'status_change':
      return L.admin.tasks.timeline.statusChange(
        String(p['from'] ?? ''), String(p['to'] ?? ''),
      );
    case 'assignment_change':
      return p['to'] === null
        ? L.admin.tasks.timeline.assignmentCleared
        : L.admin.tasks.timeline.assignmentSet;
    case 'priority_change':
      return L.admin.tasks.timeline.priorityChange(
        String(p['from'] ?? ''), String(p['to'] ?? ''),
      );
    case 'due_change':
      return p['to'] === null
        ? L.admin.tasks.timeline.dueCleared
        : L.admin.tasks.timeline.dueSet;
    case 'title_change':
      return L.admin.tasks.timeline.titleChanged;
    case 'description_change':
      return L.admin.tasks.timeline.descriptionChanged;
    case 'labels_change':
      return L.admin.tasks.timeline.labelsChanged;
    case 'category_change':
      return L.admin.tasks.timeline.categoryChange(
        categoryLabel(p['from'], L), categoryLabel(p['to'], L),
      );
  }
}

export function TaskActivityTimeline({ activities }: TaskActivityTimelineProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  if (activities.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{L.admin.tasks.timeline.empty}</Text>
      </View>
    );
  }
  return (
    <View>
      {activities.map((a) => (
        <View key={a.activityId} style={[styles.row, a.kind === 'comment' && styles.commentRow]}>
          <View style={styles.bullet} />
          <View style={styles.content}>
            <Text style={styles.body}>{describe(a, L)}</Text>
            <Text style={styles.meta}>
              {(a.actorDisplayName ?? L.admin.admins.row.unnamed)} · {fmtTs(a.createdAt)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  commentRow: { backgroundColor: colors.surface },
  bullet:     { width: 8, height: 8, borderRadius: radius.xs, backgroundColor: colors.primary, marginTop: spacing.xs },
  content:    { flex: 1, gap: spacing.xs },
  body:       { fontSize: typography.bodySmall.fontSize },
  meta:       { fontSize: typography.caption.fontSize, opacity: 0.55 },
  empty:      { padding: spacing.lg, alignItems: 'center' },
  emptyText:  { fontSize: typography.bodySmall.fontSize, opacity: 0.5 },
}));
