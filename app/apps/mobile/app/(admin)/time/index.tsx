// app/apps/mobile/app/(admin)/time/index.tsx
// V2-ADMIN-TIME-10 — V2 §13.10 Admin Time (timesheets).
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasPermission,
  isTimesheetError,
  type AdminPermission,
  type AdminRole,
  type TimesheetEntry,
  type TimesheetStatus,
} from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAuthStore } from '../../../src/store/authStore';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { TimesheetEntryCard } from '../../../src/components/admin/time/TimesheetEntryCard';
import { TimesheetFormModal } from '../../../src/components/admin/time/TimesheetFormModal';
import { AdminFilterTopBarButton } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { AdminScreenGuard } from '../../../src/components/admin/AdminScreenGuard';
import { PrimaryButton } from '../../../src/components/ui/Buttons';
import { confirmAction as platformConfirm } from '../../../src/services/platformConfirm';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

type Tab = 'mine' | 'pending' | 'all';

function confirmDelete(message: string, L: LocaleBundle): Promise<boolean> {
  const t = L.admin.time.confirm;
  return platformConfirm(t.deleteTitle, message, {
    confirmLabel: t.deleteOk,
    cancelLabel:  t.deleteCancel,
    destructive:  true,
  });
}

const timesheetKeyExtractor = (e: TimesheetEntry) => e.entryId;

const TimesheetRowItem = React.memo(function TimesheetRowItem({
  entry,
  isMine,
  canApprove,
  onEdit,
  onSubmit,
  onDelete,
  onApprove,
  onReject,
}: {
  entry: TimesheetEntry;
  isMine: boolean;
  canApprove: boolean;
  onEdit: (entry: TimesheetEntry) => void;
  onSubmit: (entryId: string) => void;
  onDelete: (entryId: string) => void;
  onApprove: (entryId: string) => void;
  onReject: (entryId: string) => void;
}) {
  const handleEdit = useCallback(() => onEdit(entry), [entry, onEdit]);
  const handleSubmit = useCallback(() => onSubmit(entry.entryId), [entry.entryId, onSubmit]);
  const handleDelete = useCallback(() => onDelete(entry.entryId), [entry.entryId, onDelete]);
  const handleApprove = useCallback(() => onApprove(entry.entryId), [entry.entryId, onApprove]);
  const handleReject = useCallback(() => onReject(entry.entryId), [entry.entryId, onReject]);

  return (
    <TimesheetEntryCard
      entry={entry}
      isMine={isMine}
      canApprove={canApprove}
      onEdit={handleEdit}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      onApprove={handleApprove}
      onReject={handleReject}
    />
  );
});

export default function TimeScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.time;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.session?.userId ?? null);

  const canApprove = can('time.approve');
  const [tab, setTab] = useState<Tab>('mine');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TimesheetEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => {
    const f: { status?: TimesheetStatus; userId?: string; limit: number } = { limit: 100 };
    if (tab === 'mine')    f.userId = myId ?? undefined;
    if (tab === 'pending') f.status = 'submitted';
    return f;
  }, [tab, myId]);

  const list = useQuery({
    queryKey: ['admin.time.list', filters],
    queryFn:  () => container.listTimesheets.execute(filters),
    enabled:  can('time.report'),
    staleTime: 15_000,
  });

  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['admin.time.list'] }); };
  const submit  = useMutation({ mutationFn: (id: string) => container.submitTimesheet.execute(id),  onSuccess: invalidate });
  const remove  = useMutation({ mutationFn: (id: string) => container.deleteTimesheet.execute(id),  onSuccess: invalidate });
  const approve = useMutation({ mutationFn: (id: string) => container.approveTimesheet.execute({ entryId: id }), onSuccess: invalidate });
  const reject  = useMutation({ mutationFn: (id: string) => container.rejectTimesheet.execute({ entryId: id }),  onSuccess: invalidate });

  const handleEdit = useCallback((entry: TimesheetEntry) => setEditing(entry), []);
  const handleSubmit = useCallback((entryId: string) => {
    void submit.mutateAsync(entryId).catch(() => {/* swallowed */});
  }, [submit]);
  const handleDelete = useCallback(async (entryId: string) => {
    const ok = await confirmDelete(t.confirm.delete, L);
    if (!ok) return;
    try {
      await remove.mutateAsync(entryId);
    } catch (err) {
      const code = isTimesheetError(err) ? err.code : 'unknown';
      const msg = t.errors[code as keyof typeof t.errors] ?? t.errors.unknown;
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.alert(msg);
      } else {
        Alert.alert(msg);
      }
    }
  }, [L, remove, t]);
  const handleApprove = useCallback((entryId: string) => {
    void approve.mutateAsync(entryId);
  }, [approve]);
  const handleReject = useCallback((entryId: string) => {
    void reject.mutateAsync(entryId);
  }, [reject]);

  const renderItem = useCallback(
    ({ item }: { item: TimesheetEntry }) => (
      <TimesheetRowItem
        entry={item}
        isMine={item.userId === myId}
        canApprove={canApprove}
        onEdit={handleEdit}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    ),
    [canApprove, handleApprove, handleDelete, handleEdit, handleReject, handleSubmit, myId],
  );

  const portalTitle = useMemo(() => {
    if (tab === 'mine') return t.title;
    if (tab === 'pending') return `${t.title} · ${t.pendingTab}`;
    return `${t.title} · ${t.allTab}`;
  }, [t.allTab, t.pendingTab, t.title, tab]);

  const newEntryBtn = (
    <PrimaryButton label={t.newBtn} size="sm" onPress={() => setCreating(true)} testID="admin-time-new" />
  );

  return (
    <AdminScreenGuard
      isLoading={rolesLoading}
      allowed={can('time.report')}
      loadingLabel={t.loading}
      forbiddenLabel={t.forbiddenTitle}
    >
    <View style={styles.root}>
      <AdminFilterTopBarButton
        portalTitle={portalTitle}
        headerRightExtra={newEntryBtn}
        activeFilterCount={tab === 'mine' ? 0 : 1}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setTab('mine')}
        sheetTitle={t.myEntriesTab}
        filterButtonTestID="admin-time-filter-button"
        filterSheetContent={(
          <FilterSection<Tab>
            options={(['mine', 'pending', 'all'] as const).map((value) => ({
              value,
              label: value === 'mine' ? t.myEntriesTab : value === 'pending' ? t.pendingTab : t.allTab,
            }))}
            value={tab}
            onChange={(v) => setTab(v ?? 'mine')}
          />
        )}
      />
      <Text style={styles.totalLabel}>{t.totalCount(list.data?.totalCount ?? 0)}</Text>

      <KcFlashList
        data={list.data?.rows ?? []}
        keyExtractor={timesheetKeyExtractor}
        estimatedItemSize={140}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />
        }
        ListEmptyComponent={
          !list.isLoading ? <AdminListEmpty title={t.emptyTitle} hint={t.emptyHint} /> : null
        }
      />

      {(creating || editing) && (
        <TimesheetFormModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </View>
    </AdminScreenGuard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  chips:       { paddingHorizontal: spacing.base, gap: spacing.sm, paddingBottom: spacing.sm },
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, fontSize: typography.caption.fontSize, opacity: 0.6 },
}));