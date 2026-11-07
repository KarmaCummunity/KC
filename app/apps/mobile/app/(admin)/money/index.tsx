// app/apps/mobile/app/(admin)/money/index.tsx
// V2-ADMIN-MONEY-9 — V2 §13.3 Admin Money — minimal donations / expenses ledger.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { adminChipScroll } from '../../../src/components/admin/adminChipScroll';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasPermission, isFinanceLedgerError,
  type AdminPermission, type AdminRole,
  type FinanceDirection, type FinanceEntry,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton } from '../../../src/components/ui/Buttons';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { FinanceEntryCard } from '../../../src/components/admin/money/FinanceEntryCard';
import { FinanceEntryFormModal } from '../../../src/components/admin/money/FinanceEntryFormModal';
import { AdminFilterChip } from '../../../src/components/admin/AdminFilterChip';
import { MoneySubNav } from '../../../src/components/admin/money/MoneySubNav';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { confirmAction as platformConfirm } from '../../../src/services/platformConfirm';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

type DirFilter = FinanceDirection | 'all';

function confirmDelete(message: string, L: LocaleBundle): Promise<boolean> {
  const t = L.admin.money.confirm;
  return platformConfirm(t.deleteTitle, message, {
    confirmLabel: t.deleteOk,
    cancelLabel:  t.deleteCancel,
    destructive:  true,
  });
}

function fmtAmount(cents: number, currency: string): string {
  const major = cents / 100;
  try { return new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(major); }
  catch { return `${major.toFixed(2)} ${currency}`; }
}

const financeKeyExtractor = (e: FinanceEntry) => e.entryId;

const FinanceRowItem = React.memo(function FinanceRowItem({
  entry,
  accountName,
  onEdit,
  onDelete,
}: {
  entry: FinanceEntry;
  accountName: string | null;
  onEdit: (entry: FinanceEntry) => void;
  onDelete: (entryId: string) => void;
}) {
  const handleEdit = useCallback(() => onEdit(entry), [entry, onEdit]);
  const handleDelete = useCallback(() => onDelete(entry.entryId), [entry.entryId, onDelete]);

  return <FinanceEntryCard entry={entry} accountName={accountName} onEdit={handleEdit} onDelete={handleDelete} />;
});

export default function MoneyScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.money;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const queryClient = useQueryClient();

  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => ({
    direction: dirFilter === 'all' ? undefined : dirFilter,
    limit: 100,
  }), [dirFilter]);

  const list = useQuery({
    queryKey: ['admin.money.list', filters],
    queryFn:  () => container.listFinanceLedger.execute(filters),
    enabled:  can('money.manage'),
    staleTime: 15_000,
  });
  const accounts = useQuery({
    queryKey: ['admin.money.accounts'],
    queryFn:  () => container.listFinanceAccounts.execute(),
    enabled:  can('money.manage'),
    staleTime: 60_000,
  });
  const accountNames = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.accountId, a.name])),
    [accounts.data],
  );
  // Newest entries come first, so the first one with an account is the most recently used one.
  const lastUsedAccountId = list.data?.rows.find((r) => r.accountId !== null)?.accountId ?? null;

  const summary = useQuery({
    queryKey: ['admin.money.summary'],
    queryFn:  () => container.getFinanceSummary.execute({}),
    enabled:  can('money.manage'),
    staleTime: 15_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => container.deleteFinanceEntry.execute(id),
    onSuccess:  () => {
      void queryClient.invalidateQueries({ queryKey: ['admin.money.list'] });
      void queryClient.invalidateQueries({ queryKey: ['admin.money.summary'] });
      void queryClient.invalidateQueries({ queryKey: ['admin.money.accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['org-transparency'] });
    },
  });

  const handleEdit = useCallback((entry: FinanceEntry) => setEditing(entry), []);
  const handleDelete = useCallback(
    async (entryId: string) => {
      const ok = await confirmDelete(t.confirm.delete, L);
      if (!ok) return;
      try {
        await remove.mutateAsync(entryId);
      } catch (err) {
        const code = isFinanceLedgerError(err) ? err.code : 'unknown';
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
    ({ item }: { item: FinanceEntry }) => (
      <FinanceRowItem
        entry={item}
        accountName={item.accountId ? (accountNames.get(item.accountId) ?? null) : null}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    ),
    [accountNames, handleDelete, handleEdit],
  );

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!can('money.manage')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{t.forbiddenTitle}</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t.title}</Text>
        <PrimaryButton testID="admin-money-new" label={t.newBtn} size="sm" onPress={() => setCreating(true)} />
      </View>

      <MoneySubNav active="ledger" />

      <View style={styles.summaryBox}>
        <Text style={styles.summaryHeading}>{t.summary.period}</Text>
        {(summary.data ?? []).length === 0 && (
          <Text style={styles.summaryEmpty}>{t.summary.empty}</Text>
        )}
        {(summary.data ?? []).map((s) => (
          <View key={s.currency} style={styles.summaryRow}>
            <Text style={styles.summaryCurrency}>{s.currency}</Text>
            <Text style={[styles.summaryIncome]}>
              {t.summary.incomeLabel}: {fmtAmount(s.incomeCents, s.currency)}
            </Text>
            <Text style={[styles.summaryExpense]}>
              {t.summary.expenseLabel}: {fmtAmount(s.expenseCents, s.currency)}
            </Text>
            <Text style={[styles.summaryNet, s.netCents >= 0 ? styles.netPositive : styles.netNegative]}>
              {t.summary.netLabel}: {fmtAmount(s.netCents, s.currency)}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal style={adminChipScroll.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, adminChipScroll.content]}>
        {(['all', 'in', 'out'] as readonly DirFilter[]).map((d) => (
          <AdminFilterChip
            key={d}
            label={d === 'all' ? t.filters.all : d === 'in' ? t.filters.income : t.filters.expense}
            active={dirFilter === d}
            onPress={() => setDirFilter(d)}
          />
        ))}
      </ScrollView>
      <Text style={styles.totalLabel}>{t.totalCount(list.data?.totalCount ?? 0)}</Text>

      <KcFlashList
        data={list.data?.rows ?? []}
        keyExtractor={financeKeyExtractor}
        estimatedItemSize={120}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); void summary.refetch(); }} />
        }
        ListEmptyComponent={
          !list.isLoading ? <AdminListEmpty title={t.emptyTitle} hint={t.emptyHint} /> : null
        }
      />

      {(creating || editing) && (
        <FinanceEntryFormModal
          initial={editing}
          accounts={accounts.data ?? []}
          defaultAccountId={lastUsedAccountId}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['admin.money.list'] });
            void queryClient.invalidateQueries({ queryKey: ['admin.money.summary'] });
            void queryClient.invalidateQueries({ queryKey: ['admin.money.accounts'] });
            void queryClient.invalidateQueries({ queryKey: ['org-transparency'] });
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { fontSize: typography.h3.fontSize, ...typography.bold },
  header:      { paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.sm,
                 flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:       { fontSize: typography.h2.fontSize, ...typography.bold },

  summaryBox: { marginHorizontal: spacing.base, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.sm,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing.xs },
  summaryHeading: { fontSize: typography.caption.fontSize, ...typography.bold, opacity: 0.65 },
  summaryEmpty:   { fontSize: typography.bodySmall.fontSize, opacity: 0.55 },
  summaryRow:     { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  summaryCurrency:{ fontSize: typography.bodySmall.fontSize, ...typography.bold },
  summaryIncome:  { fontSize: typography.bodySmall.fontSize, color: colors.success },
  summaryExpense: { fontSize: typography.bodySmall.fontSize, color: colors.error },
  summaryNet:     { fontSize: typography.bodySmall.fontSize, ...typography.bold },
  netPositive:    { color: colors.success },
  netNegative:    { color: colors.error },

  chips:          { paddingHorizontal: spacing.base, gap: spacing.sm, paddingBottom: spacing.sm },
  totalLabel:     { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, fontSize: typography.caption.fontSize, opacity: 0.6 },
}));