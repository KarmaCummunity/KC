// app/apps/mobile/app/(admin)/tasks/index.tsx
// FR-ADMIN-018 — admin tasks list screen with chip filters.
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { AdminFilterTopBarButton } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterChipRow } from '../../../src/components/filterKit/FilterChipRow';
import { Chip } from '../../../src/components/ui/Chip';
import {
  ADMIN_TASK_CATEGORIES,
  ADMIN_TASK_STATUSES, type AdminPermission, type AdminRole,
  type AdminTask,
  type AdminTaskCategory, type AdminTaskStatus,
  hasPermission,
} from '@kc/domain';
import type { AdminTaskListFilters } from '@kc/application';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton } from '../../../src/components/ui/Buttons';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminTasksList } from '../../../src/hooks/useAdminTasks';
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

const taskKeyExtractor = (t: AdminTask) => t.taskId;

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
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = useMemo<Omit<AdminTaskListFilters, 'cursor'>>(() => {
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

  const renderItem = useCallback(
    ({ item }: { item: AdminTask }) => (
      <View style={styles.rowWrap}>
        <TaskRow task={item} />
      </View>
    ),
    [styles.rowWrap],
  );

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

  const activeFilterCount =
    (statusFilter ? 1 : 0)
    + (categoryFilter ? 1 : 0)
    + (assigneeFilter ? 1 : 0)
    + (dueFromText.trim() ? 1 : 0)
    + (dueToText.trim() ? 1 : 0)
    + (onlyMine ? 1 : 0)
    + (overdueOnly ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter(null);
    setCategoryFilter(null);
    setAssigneeFilter(null);
    setDueFromText('');
    setDueToText('');
    setOnlyMine(false);
    setOverdueOnly(false);
  };

  const filtersBar = (
    <View style={styles.filterSheetBody}>
      <FilterChipRow<AdminTaskStatus>
        scrollable
        showAllChip
        allLabel={L.admin.tasks.filters.all}
        options={ADMIN_TASK_STATUSES.map((s) => ({
          value: s,
          label: L.admin.tasks.status[s],
        }))}
        value={overdueOnly ? null : statusFilter}
        onChange={(s) => {
          setStatusFilter(s);
          if (s !== null) setOverdueOnly(false);
        }}
        contentContainerStyle={styles.chips}
      >
        <Chip
          size="sm"
          label={L.admin.tasks.filters.overdue}
          selected={overdueOnly}
          onPress={() => setOverdueOnly((v) => !v)}
        />
        <Chip
          size="sm"
          label={L.admin.tasks.filters.onlyMine}
          selected={onlyMine}
          onPress={() => setOnlyMine((v) => !v)}
        />
      </FilterChipRow>

      <FilterChipRow<AdminTaskCategory>
        scrollable
        showAllChip
        allLabel={L.admin.tasks.categoryFilters.all}
        options={ADMIN_TASK_CATEGORIES.map((c) => ({
          value: c,
          label: L.admin.tasks.category[c],
        }))}
        value={categoryFilter}
        onChange={(c) => setCategoryFilter(c)}
        contentContainerStyle={styles.chips}
      />

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

  const newTaskBtn = can('tasks.create') ? (
    <PrimaryButton
      testID="admin-tasks-new"
      label={L.admin.tasks.newBtn}
      size="sm"
      onPress={() => router.push('/(admin)/tasks/new')}
    />
  ) : null;

  return (
    <View style={styles.root}>
      <AdminFilterTopBarButton
        headerRightExtra={newTaskBtn}
        activeFilterCount={activeFilterCount}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={clearFilters}
        sheetTitle={L.admin.tasks.filtersTitle}
        filterButtonTestID="admin-tasks-filter-button"
        filterSheetContent={filtersBar}
      />

      <KcFlashList
        data={q.tasks}
        keyExtractor={taskKeyExtractor}
        estimatedItemSize={80}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onEndReached={q.fetchMore}
        onEndReachedThreshold={0.5}
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

  listContent: {
    // 96pt of room under the last row, off the spacing scale's 64 + 32.
    paddingBottom: spacing['4xl'] + spacing['2xl'],
    gap: spacing.sm,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  rowWrap: { paddingHorizontal: spacing.base },

  filterSheetBody: { gap: spacing.sm },
  chips:           { gap: spacing.sm },
  empty:           { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle:      { ...typography.h4, color: colors.textPrimary },
  emptyHint:       { ...typography.bodySmall, opacity: 0.6, textAlign: 'center', color: colors.textSecondary },
}));
