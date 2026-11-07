// app/apps/mobile/app/(admin)/audit/index.tsx
// FR-ADMIN-020 — admin audit log viewer with role-tiered visibility.
// V2-ADMIN-AUDIT-5 — date-range filter + CSV export (web).
// Rebuilt on top of the shared filterKit (issue #1457).
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { type AdminAuditRow, type AdminPermission, type AdminRole, hasPermission } from '@kc/domain';
import type { AdminAuditSearchFilters } from '@kc/application';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { TextField } from '../../../src/components/ui/TextField';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminAuditSearch } from '../../../src/hooks/useAdminContentSearch';
import { AuditLogRow } from '../../../src/components/admin/content/AuditLogRow';
import { container } from '../../../src/lib/container';
import { downloadAuditCsv, isCsvExportSupported } from '../../../src/lib/auditCsvExport';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { AdminSearchFilterToolbar } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { formIsoDateInputProps } from '../../../src/lib/platform/formTextInputHints';

const COMMON_ACTIONS = [
  null,
  'ban_user',
  'manual_remove_target',
  'auto_remove_target',
  'restore_target',
  'dismiss_report',
  'confirm_report',
  'admin_role_grant',
  'admin_role_revoke',
  'admin_task_create',
  'admin_task_update',
  'admin_task_delete',
  'delete_message',
  'delete_account',
] as const;

const auditKeyExtractor = (e: AdminAuditRow) => e.eventId;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseFromDate(value: string): Date | undefined {
  if (!ISO_DATE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function parseToDate(value: string): Date | undefined {
  if (!ISO_DATE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default function AuditScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [targetIdRaw, setTargetIdRaw] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [fromRaw, setFromRaw] = useState('');
  const [toRaw, setToRaw] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = useMemo<AdminAuditSearchFilters>(() => ({
    targetUserId: targetIdRaw.trim() || undefined,
    action: action ?? undefined,
    fromDate: parseFromDate(fromRaw),
    toDate:   parseToDate(toRaw),
    limit: 100,
  }), [targetIdRaw, action, fromRaw, toRaw]);

  const result = useAdminAuditSearch(filters);
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  const renderItem = useCallback(
    ({ item }: { item: AdminAuditRow }) => <AuditLogRow row={item} />,
    [],
  );

  async function doExport() {
    setExportError(null);
    if (!isCsvExportSupported()) {
      setExportError(L.admin.content.csvExport.unsupported);
      return;
    }
    setExporting(true);
    try {
      const page = await container.adminSearchAudit.execute({
        ...filters,
        limit: 500,
        offset: 0,
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const name  = `audit-${stamp}.csv`;
      const ok = downloadAuditCsv(page.rows, name);
      if (!ok) setExportError(L.admin.content.csvExport.failed);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : L.admin.content.csvExport.failed);
    } finally {
      setExporting(false);
    }
  }

  if (rolesLoading) {
    return <View style={styles.center}><Text>{L.admin.content.loading}</Text></View>;
  }
  if (!can('audit.view_own')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{L.admin.content.forbiddenTitle}</Text></View>;
  }

  const canSeeAll = can('audit.view_any');

  const activeFilterCount =
    (action ? 1 : 0) + (fromRaw.trim() ? 1 : 0) + (toRaw.trim() ? 1 : 0);

  const clearSheetFilters = () => {
    setAction(null);
    setFromRaw('');
    setToRaw('');
  };

  const actionOptions = COMMON_ACTIONS.map((a) => ({
    value: a ?? '__all__',
    label: a === null
      ? L.admin.content.auditActionFilterAll
      : (L.admin.content.auditAction[a as keyof LocaleBundle['admin']['content']['auditAction']] ?? a),
  }));

  return (
    <View style={styles.root}>
      <AdminSearchFilterToolbar
        portalTitle={L.admin.content.auditTitle}
        search={{
          value: targetIdRaw,
          onChangeText: setTargetIdRaw,
          placeholder: L.admin.content.auditTargetPlaceholder,
          testID: 'audit-search-bar',
        }}
        activeFilterCount={activeFilterCount}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={clearSheetFilters}
        filterButtonTestID="admin-audit-filter-button"
        filterSheetContent={(
          <>
            <FilterSection<string>
              options={actionOptions}
              value={action ?? '__all__'}
              onChange={(val) => setAction(val === '__all__' || val === null ? null : val)}
            />
            <TextField
              label={L.admin.content.dateFromLabel}
              value={fromRaw}
              onChangeText={setFromRaw}
              placeholder="YYYY-MM-DD"
              {...formIsoDateInputProps}
            />
            <TextField
              label={L.admin.content.dateToLabel}
              value={toRaw}
              onChangeText={setToRaw}
              placeholder="YYYY-MM-DD"
              {...formIsoDateInputProps}
            />
          </>
        )}
      />
      {!canSeeAll ? (
        <Text style={styles.tierHint}>{L.admin.content.tierLimited}</Text>
      ) : null}
      <View style={styles.exportRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void doExport(); }}
          disabled={exporting}
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
        >
          <Text style={styles.exportBtnText}>
            {exporting ? L.admin.content.csvExport.busy : L.admin.content.csvExport.action}
          </Text>
        </Pressable>
      </View>
      {exportError !== null ? (
        <Text style={styles.exportError}>{exportError}</Text>
      ) : null}
      <Text style={styles.totalLabel}>{L.admin.content.totalCount(result.page.totalCount)}</Text>
      <KcFlashList
        data={result.page.rows}
        keyExtractor={auditKeyExtractor}
        estimatedItemSize={64}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={result.isRefetching} onRefresh={result.refetch} />}
        ListEmptyComponent={
          !result.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{L.admin.content.auditEmpty}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { ...typography.h3, ...typography.bold },
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.xs, ...typography.caption, opacity: 0.6 },
  empty:       { padding: spacing['2xl'], alignItems: 'center' },
  emptyText:   { ...typography.body, opacity: 0.6 },
  tierHint:    { paddingHorizontal: spacing.base, paddingBottom: spacing.xs, ...typography.caption, color: colors.textSecondary },
  exportRow:   { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, alignItems: 'flex-end' },
  exportBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText:  { color: colors.textInverse, ...typography.caption, ...typography.bold },
  exportError:    { paddingHorizontal: spacing.base, paddingBottom: spacing.xs, color: colors.error, ...typography.caption },
}));
