// app/apps/mobile/app/(admin)/users/index.tsx
// FR-ADMIN-019 — admin users search screen.
// Rebuilt on top of the shared filterKit (issue #1457).
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { type AdminPermission, type AdminRole, type AdminUserSearchResult, hasPermission } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminUserSearch } from '../../../src/hooks/useAdminContentSearch';
import { AdminSearchFilterToolbar } from '../../../src/components/admin/AdminSearchFilterToolbar';
import {
  AdminContentStatusFilterSection,
  adminStatusChipValue,
  countAdminStatusFilter,
} from '../../../src/components/admin/content/AdminContentStatusFilterSheet';
import { UserSearchRow } from '../../../src/components/admin/content/UserSearchRow';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

const STATUS_OPTIONS = [
  { value: null,                            key: 'all' as const },
  { value: 'active',                        key: 'active' as const },
  { value: 'pending_verification',          key: 'pending' as const },
  { value: 'banned',                        key: 'banned' as const },
  { value: 'suspended_admin',               key: 'suspendedAdmin' as const },
  { value: 'suspended_for_false_reports',   key: 'suspendedFalse' as const },
  { value: 'pending_deletion',              key: 'pendingDeletion' as const },
];

const userSearchKeyExtractor = (u: AdminUserSearchResult) => u.userId;

export default function UsersScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = useMemo(() => ({
    query: query.trim() || undefined,
    status: statusFilter ?? undefined,
  }), [query, statusFilter]);

  const result = useAdminUserSearch(filters);
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((s) => ({
      value: adminStatusChipValue(s.value),
      label: L.admin.content.userStatusFilter[s.key],
    })),
    [L.admin.content.userStatusFilter],
  );

  const renderItem = useCallback(
    ({ item }: { item: AdminUserSearchResult }) => <UserSearchRow row={item} />,
    [],
  );

  const portalTitle = useMemo(() => {
    if (!statusFilter) return L.admin.content.usersTitle;
    const opt = STATUS_OPTIONS.find((s) => s.value === statusFilter);
    if (!opt) return L.admin.content.usersTitle;
    return `${L.admin.content.usersTitle} · ${L.admin.content.userStatusFilter[opt.key]}`;
  }, [L.admin.content.userStatusFilter, L.admin.content.usersTitle, statusFilter]);

  if (rolesLoading) {
    return <View style={styles.center}><Text>{L.admin.content.loading}</Text></View>;
  }
  if (!can('users.search')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{L.admin.content.forbiddenTitle}</Text></View>;
  }

  return (
    <View style={styles.root}>
      <AdminSearchFilterToolbar
        portalTitle={portalTitle}
        search={{
          value: query,
          onChangeText: setQuery,
          placeholder: L.admin.content.searchUsersPlaceholder,
          autoCapitalize: 'none',
          testID: 'admin-users-search',
        }}
        activeFilterCount={countAdminStatusFilter(statusFilter)}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setStatusFilter(null)}
        filterButtonTestID="admin-users-filter-button"
        filterSheetContent={(
          <AdminContentStatusFilterSection
            options={statusOptions}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        )}
      />
      {!result.hasMore && (
        <Text style={styles.totalLabel}>{L.admin.content.totalCount(result.rows.length)}</Text>
      )}
      <KcFlashList
        data={result.rows}
        keyExtractor={userSearchKeyExtractor}
        estimatedItemSize={72}
        renderItem={renderItem}
        onEndReached={result.fetchMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={result.isRefetching} onRefresh={result.refetch} />}
        ListEmptyComponent={
          !result.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{L.admin.content.usersEmpty}</Text>
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
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.xs, ...typography.caption, color: colors.textSecondary },
  empty:       { padding: spacing['2xl'], alignItems: 'center' },
  emptyText:   { ...typography.body, color: colors.textSecondary },
}));
