// app/apps/mobile/app/(admin)/money/donors.tsx
// FR-FIN-023 — admin-only donors overview: cleared donations and grants grouped by party name.
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { hasPermission, type AdminRole, type FinanceDonorSummary } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { formatMoney } from '../../../src/lib/formatMoney';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { AdminScreenGuard } from '../../../src/components/admin/AdminScreenGuard';
import { AdminScreenHeader } from '../../../src/components/admin/AdminScreenHeader';
import { MoneySubNav } from '../../../src/components/admin/money/MoneySubNav';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const fmtDate = (d: Date) => d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });

export default function MoneyDonorsScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const allowed = hasPermission(roles as readonly AdminRole[], 'money.manage');

  const list = useQuery({
    queryKey: ['admin.money.donors'],
    queryFn: () => container.listFinanceDonors.execute(),
    enabled: allowed,
    staleTime: 15_000,
  });
  const donors = list.data ?? [];
  const grandTotal = donors.reduce((sum, d) => sum + d.totalCents, 0);

  return (
    <AdminScreenGuard isLoading={rolesLoading} allowed={allowed} loadingLabel={t.loading} forbiddenLabel={t.forbiddenTitle}>
      <View style={styles.root}>
        <AdminScreenHeader title={t.donors.title} />
        <MoneySubNav active="donors" />
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />}
        >
          <Text style={styles.hint}>{t.donors.hint}</Text>

          {donors.length > 0 && (
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>{t.donors.grandTotal}</Text>
              <Text style={styles.totalValue}>{formatMoney(grandTotal)}</Text>
            </View>
          )}

          {donors.map((d, i) => <DonorRow key={`${d.donorName ?? 'anonymous'}-${i}`} donor={d} />)}

          {!list.isLoading && donors.length === 0 && (
            <AdminListEmpty title={t.donors.emptyTitle} hint={t.donors.emptyHint} />
          )}
        </ScrollView>
      </View>
    </AdminScreenGuard>
  );
}

function DonorRow({ donor }: { donor: FinanceDonorSummary }) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money.donors;
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{donor.donorName ?? t.anonymous}</Text>
        <Text style={styles.meta}>
          {t.donationsCount(donor.donationsCount)} · {t.firstLast(fmtDate(donor.firstAt), fmtDate(donor.lastAt))}
        </Text>
      </View>
      <Text style={styles.amount}>{formatMoney(donor.totalCents)}</Text>
    </View>
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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.base, marginBottom: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rowText: { flex: 1, gap: spacing.xs },
  name: { ...typography.h4, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  amount: { ...typography.h4, ...typography.bold, color: colors.success },
}));
