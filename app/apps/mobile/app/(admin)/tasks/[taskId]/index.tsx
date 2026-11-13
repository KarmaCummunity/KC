// app/apps/mobile/app/(admin)/tasks/[taskId]/index.tsx
// FR-ADMIN-018 — admin task detail with status FSM, comments, activity timeline.
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Alert,
  Platform,
  RefreshControl,
  View,
} from 'react-native';
import {
  ADMIN_TASK_STATUSES, type AdminPermission, type AdminRole,
  type AdminTaskCategory, type AdminTaskStatus,
  hasPermission, isAdminTaskError, isStatusTransitionAllowed,
} from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { DangerButton, PrimaryButton, SecondaryButton } from '../../../../src/components/ui/Buttons';
import { TextField } from '../../../../src/components/ui/TextField';
import { useAuthStore } from '../../../../src/store/authStore';
import { useAdminRoles } from '../../../../src/hooks/useAdminRoles';
import { useAdminTaskDetail } from '../../../../src/hooks/useAdminTasks';
import {
  useAddAdminTaskComment, useDeleteAdminTask, useSetAdminTaskStatus, useUpdateAdminTask,
} from '../../../../src/hooks/useAdminTaskMutations';
import { TaskStatusChip } from '../../../../src/components/admin/tasks/TaskStatusChip';
import { TaskPriorityChip } from '../../../../src/components/admin/tasks/TaskPriorityChip';
import { TaskCategoryChip } from '../../../../src/components/admin/tasks/TaskCategoryChip';
import { TaskCategoryPicker } from '../../../../src/components/admin/tasks/TaskCategoryPicker';
import { TaskActivityTimeline } from '../../../../src/components/admin/tasks/TaskActivityTimeline';
import { useLocaleBundle, type LocaleBundle } from '../../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../../src/components/admin/useAdminScreenTitle';
import { FormScrollView } from '../../../../src/components/ui/FormScrollView';

async function confirmAction(message: string, L: LocaleBundle): Promise<boolean> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.confirm(message);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(L.admin.tasks.detail.confirmTitle, message, [
      { text: L.admin.tasks.detail.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: L.admin.tasks.detail.confirmOk, onPress: () => resolve(true) },
    ]);
  });
}

export default function TaskDetailScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const params = useLocalSearchParams<{ taskId: string }>();
  const taskId = params.taskId;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const myId = useAuthStore((s) => s.session?.userId ?? null);
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const q = useAdminTaskDetail(taskId);
  useAdminScreenTitle(q.detail?.task.title ?? L.admin.tasks.title);

  const setStatus = useSetAdminTaskStatus();
  const addComment = useAddAdminTaskComment();
  const remove = useDeleteAdminTask();
  const update = useUpdateAdminTask();

  const [commentBody, setCommentBody] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (rolesLoading || q.isLoading) {
    return <View style={styles.center}><Text>{L.admin.tasks.loading}</Text></View>;
  }
  if (!can('tasks.view')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{L.admin.tasks.forbiddenTitle}</Text></View>;
  }
  if (!q.detail) {
    return <View style={styles.center}><Text>{L.admin.tasks.detail.notFound}</Text></View>;
  }

  const t = q.detail.task;
  const canMoveStatus =
    can('tasks.view')
    && (hasPermission(roles as readonly AdminRole[], 'tasks.delete_any')
        || t.createdBy === myId
        || t.assigneeId === myId);
  const canDelete =
    hasPermission(roles as readonly AdminRole[], 'tasks.delete_any') || t.createdBy === myId;

  async function moveStatus(newStatus: AdminTaskStatus) {
    setErrorCode(null);
    try {
      await setStatus.mutateAsync({ taskId, newStatus });
    } catch (e) {
      setErrorCode(isAdminTaskError(e) ? e.code : 'unknown');
    }
  }

  async function changeCategory(next: AdminTaskCategory) {
    if (q.detail && next === q.detail.task.category) return;
    setErrorCode(null);
    try {
      await update.mutateAsync({ taskId, patch: { category: next } });
    } catch (e) {
      setErrorCode(isAdminTaskError(e) ? e.code : 'unknown');
    }
  }

  async function submitComment() {
    if (commentBody.trim().length === 0) return;
    setErrorCode(null);
    try {
      await addComment.mutateAsync({ taskId, body: commentBody });
      setCommentBody('');
    } catch (e) {
      setErrorCode(isAdminTaskError(e) ? e.code : 'unknown');
    }
  }

  async function deleteTask() {
    const ok = await confirmAction(L.admin.tasks.detail.deleteConfirm, L);
    if (!ok) return;
    setErrorCode(null);
    try {
      await remove.mutateAsync(taskId);
      router.back();
    } catch (e) {
      setErrorCode(isAdminTaskError(e) ? e.code : 'unknown');
    }
  }

  return (
    <FormScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />}
    >
      <View style={styles.headerRow}>
        <TaskStatusChip status={t.status} />
        <TaskPriorityChip priority={t.priority} />
        <TaskCategoryChip category={t.category} />
      </View>
      <Text style={styles.title}>{t.title}</Text>
      {t.description && <Text style={styles.description}>{t.description}</Text>}
      <View style={styles.metaCol}>
        <Text style={styles.metaText}>
          {t.assigneeDisplayName
            ? L.admin.tasks.row.assignedTo(t.assigneeDisplayName)
            : L.admin.tasks.row.unassigned}
        </Text>
        <Text style={styles.metaText}>
          {L.admin.tasks.detail.createdBy(t.createdByDisplayName ?? '?')}
        </Text>
        {t.dueAt && (
          <Text style={styles.metaText}>
            {L.admin.tasks.row.dueOn(t.dueAt.toLocaleDateString('he-IL'))}
          </Text>
        )}
      </View>

      {canMoveStatus && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{L.admin.tasks.detail.changeStatus}</Text>
          <View style={styles.statusRow}>
            {ADMIN_TASK_STATUSES
              .filter((s) => isStatusTransitionAllowed(t.status, s) && s !== t.status)
              .map((s) => (
                <SecondaryButton
                  key={s}
                  label={L.admin.tasks.status[s]}
                  size="sm"
                  disabled={setStatus.isPending}
                  onPress={() => { void moveStatus(s); }}
                />
              ))}
          </View>
        </View>
      )}

      {canMoveStatus && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{L.admin.tasks.detail.changeCategory}</Text>
          <TaskCategoryPicker
            value={t.category}
            onChange={(c) => { void changeCategory(c); }}
            disabled={update.isPending}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.tasks.detail.activity}</Text>
        <TaskActivityTimeline activities={q.detail.activities} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.tasks.detail.addComment}</Text>
        <TextField
          label=""
          value={commentBody}
          onChangeText={setCommentBody}
          placeholder={L.admin.tasks.detail.commentPlaceholder}
          multiline
          numberOfLines={3}
        />
        <View style={styles.commentActions}>
          <PrimaryButton
            label={L.admin.tasks.detail.submitComment}
            size="sm"
            disabled={commentBody.trim().length === 0}
            loading={addComment.isPending}
            onPress={() => { void submitComment(); }}
          />
        </View>
      </View>

      {errorCode !== null && (
        <Text style={styles.error}>
          {L.admin.tasks.errors[errorCode as keyof LocaleBundle['admin']['tasks']['errors']]
            ?? L.admin.tasks.errors.unknown}
        </Text>
      )}

      {canDelete && (
        <View style={styles.deleteRow}>
          <DangerButton
            label={L.admin.tasks.detail.deleteBtn}
            size="sm"
            loading={remove.isPending}
            onPress={() => { void deleteTask(); }}
          />
        </View>
      )}
    </FormScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:            { flex: 1, backgroundColor: colors.background },
  content:         { padding: spacing.base, gap: spacing.md },
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle:     { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  headerRow:       { flexDirection: 'row', gap: spacing.sm },
  title:           { ...typography.h2, ...typography.bold, color: colors.textPrimary },
  description:     { ...typography.body, color: colors.textSecondary },
  metaCol:         { gap: spacing.xs },
  metaText:        { ...typography.bodySmall, color: colors.textSecondary },
  section:         { marginTop: spacing.md, gap: spacing.sm },
  sectionTitle:    { ...typography.label, ...typography.bold, color: colors.textPrimary },
  statusRow:       { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  commentActions:  { alignItems: 'flex-end', marginTop: spacing.xs },
  error:           { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  deleteRow:       { marginTop: spacing.md, alignItems: 'flex-start' },
}));
