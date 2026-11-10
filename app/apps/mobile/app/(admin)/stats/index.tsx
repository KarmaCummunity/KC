// FR-STATS-007 — platform statistics for the team: the per-world flow funnel (admin_world_flow_funnel,
// 0542 / G43) over a selectable window, with the north-star total "givings closed" on top
// (docs/spec/16_kpis.md). Gated by 'stats.view_platform'; the server re-checks the roles.
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hasPermission, type AdminRole } from '@kc/domain';
import type { WorldFlowFunnelRow } from '@kc/application';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { getWorldFlowFunnelUseCase } from '../../../src/services/statsComposition';
import { AdminFilterTopBarButton } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { textAlignStart } from '../../../src/lib/rtlLayout';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const WINDOWS = [
  { key: 'd7', days: 7 },
  { key: 'd30', days: 30 },
  { key: 'd90', days: 90 },
] as const;

type Strings = ReturnType<typeof useLocaleBundle>['admin']['stats'];

/** A count, or the "not tracked" note when the world has no handoff stage. */
function stage(value: number | null, t: Strings): { value: string; hint?: string } {
  return value === null ? { value: '—', hint: t.notTracked } : { value: String(value) };
}

/** Median hours with one decimal, or a dash when nothing reached the stage. */
function hours(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

export default function PlatformStatsScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.stats;
  const { i18n } = useTranslation();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'stats.view_platform');
  const [days, setDays] = useState<number>(30);
  const [sheetOpen, setSheetOpen] = useState(false);

  const funnel = useQuery({
    queryKey: ['admin.stats.funnel', days],
    queryFn: () => getWorldFlowFunnelUseCase().execute(days),
    enabled,
    staleTime: 60_000,
  });

  if (rolesLoading) return <View style={styles.center}><Text>{t.loading}</Text></View>;
  if (!enabled) return <View style={styles.center}><Text style={styles.forbidden}>{t.forbidden}</Text></View>;

  const isHebrew = i18n.language.startsWith('he');
  const rows = funnel.data ?? [];
  // North star (spec 16): givings closed in the window, across worlds and directions.
  const closedTotal = rows.reduce((sum, r) => sum + r.closed, 0);
  const label = (r: WorldFlowFunnelRow) => `${isHebrew ? r.worldLabelHe : r.worldLabelEn} · ${t.directions[r.direction]}`;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={funnel.isFetching} onRefresh={() => { void funnel.refetch(); }} />}
    >
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.muted}>{t.subtitle}</Text>

      <AdminFilterTopBarButton
        portalTitle={t.title}
        activeFilterCount={days === 30 ? 0 : 1}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setDays(30)}
        sheetTitle={t.windows.d30}
        filterButtonTestID="admin-stats-filter-button"
        filterSheetContent={(
          <FilterSection<number>
            options={WINDOWS.map((w) => ({ value: w.days, label: t.windows[w.key] }))}
            value={days}
            onChange={(v) => setDays(v ?? 30)}
            showAllChip={false}
          />
        )}
      />

      {funnel.isError ? <Text style={styles.error}>{t.error}</Text> : null}
      {!funnel.isLoading && !funnel.isError && rows.length === 0 ? <AdminListEmpty title={t.empty} hint="" /> : null}

      {rows.length > 0 ? (
        <View style={styles.card} testID="admin-stats-total">
          <Text style={styles.total}>{String(closedTotal)}</Text>
          <Text style={styles.muted}>{t.totals}</Text>
        </View>
      ) : null}

      {rows.map((r) => (
        <View key={`${r.worldSlug}-${r.direction}`} style={styles.card} testID={`admin-stats-${r.worldSlug}-${r.direction}`}>
          <Text style={styles.cardTitle}>{label(r)}</Text>
          <View style={styles.kpiGrid}>
            <Kpi label={t.metrics.published} value={String(r.published)} />
            <Kpi label={t.metrics.booked} {...stage(r.booked, t)} />
            <Kpi label={t.metrics.confirmed} {...stage(r.confirmed, t)} />
            <Kpi label={t.metrics.completed} {...stage(r.completed, t)} />
            <Kpi label={t.metrics.cancelled} {...stage(r.cancelled, t)} />
            <Kpi label={t.metrics.closed} value={String(r.closed)} />
            <Kpi label={t.metrics.hoursToBooking} value={hours(r.medianHoursToBooking)} />
            <Kpi label={t.metrics.hoursToCompletion} value={hours(r.medianHoursToCompletion)} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
      {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, paddingBottom: spacing['2xl'], gap: spacing.sm, width: '100%', maxWidth: 900, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forbidden: { color: colors.error, textAlign: 'center' },
  title: { fontSize: typography.h2.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  total: { fontSize: typography.h1.fontSize, ...typography.extraBold, color: colors.primary, textAlign: textAlignStart() },
  cardTitle: { fontSize: typography.bodyLarge.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    flexGrow: 1, flexBasis: 140, minWidth: 120, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  kpiValue: { fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  kpiLabel: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
  kpiHint: { fontSize: typography.caption.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
}));
