// app/apps/mobile/app/(admin)/users/index.tsx
// FR-ADMIN-019 — admin users search screen.
// Rebuilt on top of the shared filterKit (issue #1457).
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { type AdminPermission, type AdminRole, type AdminUserSearchResult, hasPermission } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminUserSearch } from '../../../src/hooks/useAdminContentSearch';
import { AdminScreenHeader } from '../../../src/components/admin/AdminScreenHeader';
import { UserSearchRow } from '../../../src/components/admin/content/UserSearchRow';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { FilterSearchBar } from '../../../src/components/filterKit/FilterSearchBar';
import { FilterChipRow } from '../../../src/components/filterKit/FilterChipRow';

const STATUS_OPTIONS = [
  { value: null,                            key: 'all' as const },
  { value: 'active',                        key: 'active' as const },
  { value: 'pending_verification',          key: 'pending' as const },
  { value: 'banned',                        key: 'banned' as const },
  { value: 'suspended_admin',               key: 'suspendedAdmin' as const },
  { value: 'suspended_for_false_reports',   key: 'suspendedFalse' as const },
  { value: 'deleted',                       key: 'deleted' as const },
];

const userSearchKeyExtractor = (u: AdminUserSearchResult) => u.userId;

export default function UsersScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filters = useMemo(() => ({
    query: query.trim() || undefined,
    status: statusFilter ?? undefined,
  }), [query, statusFilter]);

  const result = useAdminUserSearch(filters);
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  const renderItem = useCallback(
    ({ item }: { item: AdminUserSearchResult }) => <UserSearchRow row={item} />,
    [],
  );

  if (rolesLoading) {
    return <View style={styles.center}><Text>{L.admin.content.loading}</Text></View>;
  }
  if (!can('users.search')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{L.admin.content.forbiddenTitle}</Text></View>;
  }

  return (
    <View style={styles.root}>
      <AdminScreenHeader title={L.admin.content.usersTitle} />
      <FilterSearchBar
        style={styles.searchWrap}
        value={query}
        onChangeText={setQuery}
        placeholder={L.admin.content.searchUsersPlaceholder}
        autoCapitalize="none"
      />
      <FilterChipRow<string>
        scrollable
        options={STATUS_OPTIONS.map((s) => ({
          value: s.value ?? '__all__',
          label: L.admin.content.userStatusFilter[s.key],
        }))}
        value={statusFilter ?? '__all__'}
        onChange={(val) => setStatusFilter(val === '__all__' || val === null ? null : val)}
        contentContainerStyle={styles.chips}
      />
      <Text style={styles.totalLabel}>
        {L.admin.content.totalCount(result.page.totalCount)}
      </Text>
      <KcFlashList
        data={result.page.rows}
        keyExtractor={userSearchKeyExtractor}
        estimatedItemSize={72}
        renderItem={renderItem}
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
  searchWrap:  { marginHorizontal: spacing.base, marginBottom: spacing.sm },
  chips:       { paddingHorizontal: spacing.base, gap: spacing.sm, paddingBottom: spacing.sm },
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.xs, ...typography.caption, color: colors.textSecondary },
  empty:       { padding: spacing['2xl'], alignItems: 'center' },
  emptyText:   { ...typography.body, color: colors.textSecondary },
}));
