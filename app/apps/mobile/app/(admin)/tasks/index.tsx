// app/apps/mobile/app/(admin)/tasks/index.tsx
// FR-ADMIN-018 — admin tasks list screen with chip filters.
import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { adminChipScroll } from '../../../src/components/admin/adminChipScroll';
import { AdminFilterChip } from '../../../src/components/admin/AdminFilterChip';
import {
  ADMIN_TASK_CATEGORIES,
  ADMIN_TASK_STATUSES, type AdminPermission, type AdminRole,
  type AdminTaskCategory, type AdminTaskStatus,
  hasPermission,
} from '@kc/domain';
import type { AdminTaskListFilters } from '@kc/application';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminTasksList } from '../../../src/hooks/useAdminTasks';
import { AdminScreenHeader } from '../../../src/components/admin/AdminScreenHeader';
import { TaskRow } from '../../../src/components/admin/tasks/TaskRow';
import {
  TaskAssigneeFilter,
  UNASSIGNED_TOKEN,
  type AssigneeFilterValue,
} from '../../../src/components/admin/tasks/TaskAssigneeFilter';
import {
  TaskDueRangeFilter,
  isValidIsoDate,
} from '../../../src/components/admin/tasks/TaskDueRangeFilter';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

function parseDueFrom(value: string): Date | undefined {
  if (!isValidIsoDate(value) || value.length === 0) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDueTo(value: string): Date | undefined {
  if (!isValidIsoDate(value) || value.length === 0) return undefined;
  // End-of-day so a "to" of 2026-06-01 includes anything dated that day.
  return new Date(`${value}T23:59:59.999Z`);
}

export default function TasksScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [statusFilter, setStatusFilter] = useState<AdminTaskStatus | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<AdminTaskCategory | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>(null);
  const [dueFromText, setDueFromText] = useState('');
  const [dueToText, setDueToText] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filters = useMemo<AdminTaskListFilters>(() => {
    const baseAssignee = assigneeFilter && assigneeFilter !== UNASSIGNED_TOKEN
      ? assigneeFilter
      : undefined;
    return {
      status:         statusFilter   ?? undefined,
      category:       categoryFilter ?? undefined,
      assigneeId:     baseAssignee,
      unassignedOnly: assigneeFilter === UNASSIGNED_TOKEN ? true : undefined,
      dueFrom:        parseDueFrom(dueFromText),
      dueTo:          parseDueTo(dueToText),
      onlyMine,
      overdue:        overdueOnly,
    };
  }, [statusFilter, categoryFilter, assigneeFilter, dueFromText, dueToText, onlyMine, overdueOnly]);

  const q = useAdminTasksList(filters);
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  if (rolesLoading) {
    return <View style={styles.center}><Text>{L.admin.tasks.loading}</Text></View>;
  }
  if (!can('tasks.view')) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>{L.admin.tasks.forbiddenTitle}</Text>
      </View>
    );
  }

  const filtersBar = (
    <View style={styles.filterCard}>
      <Text style={styles.filterTitle}>{L.admin.tasks.filtersTitle}</Text>

      <ScrollView horizontal style={adminChipScroll.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, adminChipScroll.content]}>
        <AdminFilterChip
          label={L.admin.tasks.filters.all}
          active={statusFilter === null && !overdueOnly}
          onPress={() => { setStatusFilter(null); setOverdueOnly(false); }}
        />
        {ADMIN_TASK_STATUSES.map((s) => (
          <AdminFilterChip
            key={s}
            label={L.admin.tasks.status[s]}
            active={statusFilter === s}
            onPress={() => { setStatusFilter(statusFilter === s ? null : s); }}
          />
        ))}
        <AdminFilterChip
          label={L.admin.tasks.filters.overdue}
          active={overdueOnly}
          onPress={() => setOverdueOnly((v) => !v)}
        />
        <AdminFilterChip
          label={L.admin.tasks.filters.onlyMine}
          active={onlyMine}
          onPress={() => setOnlyMine((v) => !v)}
        />
      </ScrollView>

      <ScrollView horizontal style={adminChipScroll.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, adminChipScroll.content]}>
        <AdminFilterChip
          label={L.admin.tasks.categoryFilters.all}
          active={categoryFilter === null}
          onPress={() => setCategoryFilter(null)}
        />
        {ADMIN_TASK_CATEGORIES.map((c) => (
          <AdminFilterChip
            key={c}
            label={L.admin.tasks.category[c]}
            active={categoryFilter === c}
            onPress={() => setCategoryFilter(categoryFilter === c ? null : c)}
          />
        ))}
      </ScrollView>

      {can('admins.view') && (
        <TaskAssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} />
      )}

      <TaskDueRangeFilter
        fromValue={dueFromText}
        toValue={dueToText}
        onChange={({ from, to }) => { setDueFromText(from); setDueToText(to); }}
        onClear={() => { setDueFromText(''); setDueToText(''); }}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      <AdminScreenHeader
        title={L.admin.tasks.title}
        subtitle={!q.isLoading ? L.admin.tasks.countLabel(q.tasks.length) : undefined}
        right={can('tasks.create') ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(admin)/tasks/new')}
            style={styles.newBtn}
          >
            <Text style={styles.newBtnText}>{L.admin.tasks.newBtn}</Text>
          </Pressable>
        ) : undefined}
      />

      <KcFlashList
        data={[...q.tasks]}
        keyExtractor={(t) => t.taskId}
        renderItem={({ item }) => (
          <View style={styles.rowWrap}><TaskRow task={item} /></View>
        )}
        ListHeaderComponent={filtersBar}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />
        }
        ListEmptyComponent={
          !q.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{L.admin.tasks.emptyTitle}</Text>
              <Text style={styles.emptyHint}>{L.admin.tasks.emptyHint}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:            { flex: 1, backgroundColor: colors.background },
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle:     { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  newBtn:          { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  newBtnText:      { ...typography.bodySmall, ...typography.bold, color: colors.textInverse },

  listContent: {
    // 96pt of room under the last row, off the spacing scale's 64 + 32.
    paddingBottom: spacing['4xl'] + spacing['2xl'],
    gap: spacing.sm,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  rowWrap: { paddingHorizontal: spacing.base },

  filterCard: {
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterTitle: {
    ...typography.label,
    ...typography.extraBold,
    color: colors.textSecondary,
    letterSpacing: 0.3,
    writingDirection: 'rtl',
  },
  chips:           { gap: spacing.sm },
  empty:           { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle:      { ...typography.h4, color: colors.textPrimary },
  emptyHint:       { ...typography.bodySmall, opacity: 0.6, textAlign: 'center', color: colors.textSecondary },
}));
