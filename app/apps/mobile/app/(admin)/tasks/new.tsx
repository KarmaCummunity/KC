// app/apps/mobile/app/(admin)/tasks/new.tsx
// FR-ADMIN-018 — create new admin task (title required + optional fields).
import { useState } from 'react';
import { router } from 'expo-router';
import {
  View,
} from 'react-native';
import {
  ADMIN_TASK_CATEGORY_DEFAULT,
  ADMIN_TASK_PRIORITIES, type AdminPermission, type AdminRole,
  type AdminTaskCategory, type AdminTaskPriority,
  hasPermission, isAdminTaskError,
} from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { TextField } from '../../../src/components/ui/TextField';
import { Chip } from '../../../src/components/ui/Chip';
import { AdminFormActions } from '../../../src/components/admin/AdminFormActions';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useCreateAdminTask } from '../../../src/hooks/useAdminTaskMutations';
import { AssigneePicker } from '../../../src/components/admin/tasks/AssigneePicker';
import { TaskCategoryPicker } from '../../../src/components/admin/tasks/TaskCategoryPicker';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { FormScrollView } from '../../../src/components/ui/FormScrollView';

export default function NewTaskScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { roles } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<AdminTaskPriority>('medium');
  const [category, setCategory] = useState<AdminTaskCategory>(ADMIN_TASK_CATEGORY_DEFAULT);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelsRaw, setLabelsRaw] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const create = useCreateAdminTask();
  const canSubmit = title.trim().length > 0 && !create.isPending;

  if (!can('tasks.create')) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>{L.admin.tasks.forbiddenTitle}</Text>
      </View>
    );
  }

  async function submit() {
    if (!canSubmit) return;
    setErrorCode(null);
    setErrorDetail(null);
    try {
      const labels = labelsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const taskId = await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category,
        assigneeId,
        labels,
      });
      router.replace({ pathname: '/(admin)/tasks/[taskId]', params: { taskId } });
    } catch (e) {
      console.error('[admin tasks] create failed', e);
      if (isAdminTaskError(e)) {
        setErrorCode(e.code);
        setErrorDetail(null);
      } else {
        setErrorCode('unknown');
        setErrorDetail(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return (
    <FormScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{L.admin.tasks.form.newTitle}</Text>

      <TextField
        label={L.admin.tasks.form.titleLabel}
        value={title}
        onChangeText={setTitle}
        placeholder={L.admin.tasks.form.titlePlaceholder}
        maxLength={200}
      />

      <TextField
        label={L.admin.tasks.form.descriptionLabel}
        value={description}
        onChangeText={setDescription}
        placeholder={L.admin.tasks.form.descriptionPlaceholder}
        multiline
        numberOfLines={4}
      />

      <Text style={styles.label}>{L.admin.tasks.form.priorityLabel}</Text>
      <View style={styles.priorityRow}>
        {ADMIN_TASK_PRIORITIES.map((p) => (
          <Chip
            key={p}
            label={L.admin.tasks.priority[p]}
            selected={priority === p}
            onPress={() => setPriority(p)}
            size="sm"
          />
        ))}
      </View>

      <Text style={styles.label}>{L.admin.tasks.form.categoryLabel}</Text>
      <TaskCategoryPicker value={category} onChange={setCategory} />

      {can('admins.view') && (
        <>
          <Text style={styles.label}>{L.admin.tasks.form.assigneeLabel}</Text>
          <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
        </>
      )}

      <TextField
        label={L.admin.tasks.form.labelsLabel}
        value={labelsRaw}
        onChangeText={setLabelsRaw}
        placeholder={L.admin.tasks.form.labelsPlaceholder}
      />

      <AdminFormActions
        cancelLabel={L.admin.tasks.form.cancel}
        submitLabel={L.admin.tasks.form.submit}
        submittingLabel={L.admin.tasks.form.submit}
        isPending={create.isPending}
        onCancel={() => router.back()}
        onSubmit={() => { void submit(); }}
        errorMsg={
          errorCode !== null
            ? (L.admin.tasks.errors[errorCode as keyof LocaleBundle['admin']['tasks']['errors']]
                ?? L.admin.tasks.errors.unknown) + (errorDetail ? `: ${errorDetail}` : '')
            : null
        }
      />
    </FormScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  content:     { padding: spacing.base, gap: spacing.sm },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  title:       { ...typography.h2, ...typography.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  label:       { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  priorityRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
}));
