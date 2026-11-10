// app/apps/mobile/app/(admin)/money/accounts.tsx
// FR-FIN-003 (lean) — financial accounts with computed balances.
import React, { useCallback, useMemo, useState } from 'react';
import { PrimaryButton } from '../../../src/components/ui/Buttons';
import { useAdminPortalChrome } from '../../../src/components/admin/AdminPortalChrome';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, isFinanceLedgerError, type AdminRole, type FinanceAccount } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { formatMoney } from '../../../src/lib/formatMoney';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { AdminScreenGuard } from '../../../src/components/admin/AdminScreenGuard';
import { FinanceAccountCard } from '../../../src/components/admin/money/FinanceAccountCard';
import { FinanceAccountFormModal } from '../../../src/components/admin/money/FinanceAccountFormModal';
import { MoneySubNav } from '../../../src/components/admin/money/MoneySubNav';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { alertError } from '../../../src/components/admin/money/alertError';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MoneyAccountsScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const allowed = hasPermission(roles as readonly AdminRole[], 'money.manage');
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const newAccountBtn = useMemo(
    () => (
      <PrimaryButton
        label={t.accounts.newBtn}
        size="sm"
        onPress={() => setCreating(true)}
        testID="admin-money-account-new"
      />
    ),
    [t.accounts.newBtn],
  );
  useAdminPortalChrome({ headerRight: newAccountBtn });

  const list = useQuery({
    queryKey: ['admin.money.accounts'],
    queryFn: () => container.listFinanceAccounts.execute(),
    enabled: allowed,
    staleTime: 15_000,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['admin.money.accounts'] }),
    [queryClient],
  );

  const toggleActive = useMutation({
    mutationFn: (a: FinanceAccount) =>
      container.upsertFinanceAccount.execute({ accountId: a.accountId, isActive: !a.isActive }),
    onSuccess: () => { void refresh(); },
    onError: (err) => alertError(isFinanceLedgerError(err) ? err.code : 'unknown', t.errors),
  });

  const accounts = useMemo(() => list.data ?? [], [list.data]);
  const active = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const inactive = useMemo(() => accounts.filter((a) => !a.isActive), [accounts]);
  // Balances are ILS-only (the ledger writes ILS exclusively), so a plain sum is correct.
  const total = active.reduce((sum, a) => sum + a.balanceCents, 0);

  const renderCard = (a: FinanceAccount) => (
    <FinanceAccountCard
      key={a.accountId}
      account={a}
      onEdit={() => setEditing(a)}
      onToggleActive={() => toggleActive.mutate(a)}
    />
  );

  return (
    <AdminScreenGuard isLoading={rolesLoading} allowed={allowed} loadingLabel={t.loading} forbiddenLabel={t.forbiddenTitle}>
      <View style={styles.root}>
        <MoneySubNav active="accounts" />
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />}
        >
          <Text style={styles.hint}>{t.accounts.hint}</Text>

          {accounts.length > 0 && (
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>{t.accounts.totalBalance}</Text>
              <Text style={styles.totalValue}>{formatMoney(total)}</Text>
            </View>
          )}

          {active.map(renderCard)}

          {!list.isLoading && accounts.length === 0 && (
            <AdminListEmpty title={t.accounts.emptyTitle} hint={t.accounts.emptyHint} />
          )}

          {inactive.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t.accounts.inactiveSection}</Text>
              {inactive.map(renderCard)}
            </>
          )}
        </ScrollView>

        {(creating || editing) && (
          <FinanceAccountFormModal
            initial={editing}
            onClose={() => { setCreating(false); setEditing(null); }}
            onSaved={() => { setCreating(false); setEditing(null); void refresh(); }}
          />
        )}
      </View>
    </AdminScreenGuard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing['3xl'] },
  hint: { ...typography.bodySmall, color: colors.textSecondary, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  totalBox: {
    marginHorizontal: spacing.base, marginBottom: spacing.sm, padding: spacing.md, gap: spacing.xs,
    borderRadius: radius.md, backgroundColor: colors.primarySurface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primaryLight,
  },
  totalLabel: { ...typography.caption, color: colors.textSecondary },
  totalValue: { ...typography.h2, ...typography.bold, color: colors.textPrimary },
  sectionTitle: { ...typography.label, color: colors.textSecondary, padding: spacing.base, paddingBottom: spacing.sm },
}));
