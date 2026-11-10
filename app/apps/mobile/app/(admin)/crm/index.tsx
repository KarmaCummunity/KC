// app/apps/mobile/app/(admin)/crm/index.tsx
// V2-ADMIN-CRM-8 — V2 §13.9 Admin CRM (minimal contacts tracker).
// List + search + status filter + per-row edit / delete / "mark contacted".
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CRM_CONTACT_STATUSES, hasPermission, isCrmContactError,
  type AdminPermission, type AdminRole,
  type CrmContact, type CrmContactStatus,
} from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { ContactCard } from '../../../src/components/admin/crm/ContactCard';
import { ContactFormModal } from '../../../src/components/admin/crm/ContactFormModal';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { AdminSearchFilterToolbar } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { PrimaryButton } from '../../../src/components/ui/Buttons';

type StatusFilter = CrmContactStatus | 'all';

const crmContactKeyExtractor = (c: CrmContact) => c.contactId;

const CrmContactItemRow = React.memo(function CrmContactItemRow({
  contact,
  onEdit,
  onMarkContacted,
  onDelete,
}: {
  contact: CrmContact;
  onEdit: (c: CrmContact) => void;
  onMarkContacted: (contactId: string) => void;
  onDelete: (contactId: string) => void;
}) {
  const handleEdit = useCallback(() => onEdit(contact), [contact, onEdit]);
  const handleMark = useCallback(
    () => onMarkContacted(contact.contactId),
    [contact.contactId, onMarkContacted],
  );
  const handleDelete = useCallback(
    () => onDelete(contact.contactId),
    [contact.contactId, onDelete],
  );

  return (
    <ContactCard
      contact={contact}
      onEdit={handleEdit}
      onMarkContacted={handleMark}
      onDelete={handleDelete}
    />
  );
});

async function confirmAction(message: string, L: LocaleBundle): Promise<boolean> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.confirm(message);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(L.admin.crm.confirm.deleteTitle, message, [
      { text: L.admin.crm.confirm.deleteCancel, style: 'cancel', onPress: () => resolve(false) },
      { text: L.admin.crm.confirm.deleteOk, onPress: () => resolve(true) },
    ]);
  });
}

export default function CrmScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.crm;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => ({
    status: statusFilter === 'all' ? undefined : statusFilter,
    query:  query.trim() || undefined,
    limit:  100,
  }), [statusFilter, query]);

  const list = useQuery({
    queryKey: ['admin.crm.list', filters],
    queryFn:  () => container.listCrmContacts.execute(filters),
    enabled:  can('crm.manage'),
    staleTime: 15_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => container.deleteCrmContact.execute(id),
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['admin.crm.list'] }); },
  });
  const markContacted = useMutation({
    mutationFn: (id: string) => container.markCrmContactContacted.execute(id),
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['admin.crm.list'] }); },
  });

  const handleEdit = useCallback((contact: CrmContact) => setEditing(contact), []);
  const handleMarkContacted = useCallback(
    (contactId: string) => {
      void markContacted.mutateAsync(contactId);
    },
    [markContacted],
  );
  const handleDelete = useCallback(
    async (contactId: string) => {
      const ok = await confirmAction(t.confirm.delete, L);
      if (!ok) return;
      try {
        await remove.mutateAsync(contactId);
      } catch (err) {
        const code = isCrmContactError(err) ? err.code : 'unknown';
        const msg = t.errors[code as keyof typeof t.errors] ?? t.errors.unknown;
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert(msg);
        } else {
          Alert.alert(msg);
        }
      }
    },
    [L, remove, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: CrmContact }) => (
      <CrmContactItemRow
        contact={item}
        onEdit={handleEdit}
        onMarkContacted={handleMarkContacted}
        onDelete={handleDelete}
      />
    ),
    [handleDelete, handleEdit, handleMarkContacted],
  );

  const statusOptions = useMemo(
    () => (['all', ...CRM_CONTACT_STATUSES] as readonly StatusFilter[]).map((s) => ({
      value: s,
      label: t.statusFilters[s],
    })),
    [t.statusFilters],
  );

  const portalTitle = useMemo(() => {
    if (statusFilter === 'all') return t.title;
    return `${t.title} · ${t.statusFilters[statusFilter]}`;
  }, [statusFilter, t.statusFilters, t.title]);

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!can('crm.manage')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{t.forbiddenTitle}</Text></View>;
  }

  const rows = list.data?.rows ?? [];

  return (
    <View style={styles.root}>
      <AdminSearchFilterToolbar
        portalTitle={portalTitle}
        headerRightExtra={
          <PrimaryButton label={t.newBtn} size="sm" onPress={() => setCreating(true)} testID="admin-crm-new" />
        }
        search={{
          value: query,
          onChangeText: setQuery,
          placeholder: t.searchPlaceholder,
          testID: 'crm-search-bar',
        }}
        activeFilterCount={statusFilter === 'all' ? 0 : 1}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setStatusFilter('all')}
        filterButtonTestID="admin-crm-filter-button"
        filterSheetContent={(
          <FilterSection<StatusFilter>
            options={statusOptions}
            value={statusFilter}
            onChange={(s) => setStatusFilter(s ?? 'all')}
          />
        )}
      />
      <Text style={styles.totalLabel}>{t.totalCount(list.data?.totalCount ?? 0)}</Text>

      <KcFlashList
        data={rows}
        keyExtractor={crmContactKeyExtractor}
        estimatedItemSize={140}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />
        }
        ListEmptyComponent={
          !list.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t.emptyTitle}</Text>
              <Text style={styles.emptyHint}>{t.emptyHint}</Text>
            </View>
          ) : null
        }
      />

      {(creating || editing) && (
        <ContactFormModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['admin.crm.list'] });
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { ...typography.h3, ...typography.bold },
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, ...typography.caption, opacity: 0.6 },
  empty:       { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle:  { ...typography.h3, ...typography.semiBold },
  emptyHint:   { ...typography.caption, opacity: 0.6, textAlign: 'center' },
}));
