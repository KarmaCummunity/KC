// app/apps/mobile/src/components/admin/tasks/TaskRow.tsx
// FR-ADMIN-018 — single task row for /admin/tasks list.
import { memo } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { type AdminTask, isOverdue } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { TaskStatusChip } from './TaskStatusChip';
import { TaskPriorityChip } from './TaskPriorityChip';
import { TaskCategoryChip } from './TaskCategoryChip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface TaskRowProps {
  readonly task: AdminTask;
}

function fmtDue(d: Date): string {
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function TaskRowInner({ task }: TaskRowProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const overdue = isOverdue(task);
  return (
    <Pressable
      style={styles.root}
      onPress={() =>
        router.push({ pathname: '/(admin)/tasks/[taskId]', params: { taskId: task.taskId } })
      }
    >
      <View style={styles.header}>
        <TaskStatusChip status={task.status} />
        <TaskPriorityChip priority={task.priority} />
        <TaskCategoryChip category={task.category} />
        {overdue && (
          <View style={styles.overdueChip}>
            <Text style={styles.overdueText}>{L.admin.tasks.overdueBadge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {task.assigneeDisplayName
            ? L.admin.tasks.row.assignedTo(task.assigneeDisplayName)
            : L.admin.tasks.row.unassigned}
        </Text>
        {task.dueAt && (
          <Text style={[styles.metaText, overdue && styles.overdueLabel]}>
            {L.admin.tasks.row.dueOn(fmtDue(task.dueAt))}
          </Text>
        )}
        {task.commentCount > 0 && (
          <Text style={styles.metaText}>{L.admin.tasks.row.comments(task.commentCount)}</Text>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    padding: spacing.md, gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  header:       { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  title:        { fontSize: typography.button.fontSize, ...typography.semiBold },
  meta:         { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  metaText:     { fontSize: typography.bodySmall.fontSize, opacity: 0.7 },
  overdueLabel: { color: colors.error, opacity: 1 },
  overdueChip:  { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, borderRadius: radius.xs, backgroundColor: colors.errorLight },
  overdueText:  { fontSize: typography.caption.fontSize, ...typography.bold, color: colors.error },
}));

export const TaskRow = memo(TaskRowInner);
