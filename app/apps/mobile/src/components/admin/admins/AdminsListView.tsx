// app/apps/mobile/src/components/admin/admins/AdminsListView.tsx
// FR-ADMIN-022 — the "list" tab of the admins screen: one card per user with an
// include-revoked toggle. Split out of the screen to keep each unit small.
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, Switch, View } from 'react-native';
import { type AdminPerson, groupGrantsByUser } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminsList } from '../../../hooks/useAdminsList';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { AdminPersonCard } from './AdminPersonCard';
import { buildAdminListItems, type AdminListItem } from './adminListItems';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { KcFlashList } from '../../lists/KcFlashList';

export interface AdminsListViewProps {
  readonly isWide: boolean;
  readonly onSelect: (userId: string) => void;
}

function renderItem(item: AdminListItem, onSelect: (userId: string) => void, styles: ReturnType<typeof useStyles>) {
  if (item.kind === 'header') {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{item.title}</Text>
        <Text style={styles.sectionHeaderCount}>{item.count}</Text>
      </View>
    );
  }
  return <AdminPersonCard person={item.person} onPress={onSelect} />;
}

const adminListKeyExtractor = (it: AdminListItem) =>
  it.kind === 'header' ? `h:${it.title}` : `p:${it.person.userId}`;

export function AdminsListView({ isWide, onSelect }: AdminsListViewProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const list = useAdminsList(includeRevoked);
  const people = useMemo<readonly AdminPerson[]>(() => groupGrantsByUser(list.grants), [list.grants]);
  const items = useMemo(() => buildAdminListItems(people, includeRevoked), [people, includeRevoked]);

  const contentContainerStyle = useMemo(
    () => [styles.listContent, isWide && styles.listContentWide],
    [isWide, styles.listContent, styles.listContentWide],
  );

  const handleRenderItem = useCallback(
    ({ item }: { item: AdminListItem }) => renderItem(item, onSelect, styles),
    [onSelect, styles],
  );

  return (
    <View style={styles.fill}>
      <View style={styles.toggleRow}>
        <Switch value={includeRevoked} onValueChange={setIncludeRevoked} />
        <Text style={styles.toggleLabel}>{L.admin.admins.includeRevokedLabel}</Text>
      </View>
      <KcFlashList
        data={items}
        keyExtractor={adminListKeyExtractor}
        estimatedItemSize={72}
        contentContainerStyle={contentContainerStyle}
        renderItem={handleRenderItem}
        ListEmptyComponent={list.isLoading ? null : <EmptyState />}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} />}
      />
    </View>
  );
}

function EmptyState() {
  const styles = useStyles();
  const L = useLocaleBundle();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{L.admin.admins.emptyTitle}</Text>
      <Text style={styles.emptyHint}>{L.admin.admins.emptyHint}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  fill:        { flex: 1 },
  toggleRow:   { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  toggleLabel: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary },
  listContent:     { paddingBottom: spacing.xl },
  listContentWide: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  sectionHeader: {
    flexDirection: rowDirectionStart, justifyContent: 'space-between',
    paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.xs,
  },
  sectionHeaderText:  { fontSize: typography.body.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  sectionHeaderCount: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary },
  empty:      { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: typography.bodyLarge.fontSize, ...typography.semiBold, color: colors.textPrimary },
  emptyHint:  { fontSize: typography.bodySmall.fontSize, opacity: 0.6, textAlign: 'center', color: colors.textSecondary },
}));