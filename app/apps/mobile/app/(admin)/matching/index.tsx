// KC#1122 / FR-ADMIN-029 — match quality per world: alerted pairs, precision proxy,
// notification→chat and completion rates over a selectable window (admin_match_quality, 0454).
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hasPermission, type AdminRole } from '@kc/domain';
import type { MatchQualityByWorld } from '@kc/infrastructure-supabase';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { getMatchRepository } from '../../../src/services/matchingComposition';
import { listOrEmpty } from '../../../src/lib/backendAvailability';
import { AdminFilterTopBarButton } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { formatAdminPercent } from '../../../src/components/admin/formatAdminPercent';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { textAlignStart } from '../../../src/lib/rtlLayout';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const WINDOWS = [
  { key: 'd7', days: 7 },
  { key: 'd30', days: 30 },
  { key: 'd90', days: 90 },
] as const;

export default function MatchQualityScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.matching;
  const { i18n } = useTranslation();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'matching.view_quality');
  const [days, setDays] = useState<number>(30);
  const [sheetOpen, setSheetOpen] = useState(false);

  const quality = useQuery({
    queryKey: ['admin.matching.quality', days],
    // The baseline has no match quality report (M14): an unavailable backend shows the empty state.
    queryFn: () => listOrEmpty(() => getMatchRepository().qualityByWorld(days)),
    enabled,
    staleTime: 60_000,
  });

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!enabled) {
    return <View style={styles.center}><Text style={styles.forbidden}>{t.forbiddenTitle}</Text></View>;
  }

  const isHebrew = i18n.language.startsWith('he');
  const worldLabel = (w: MatchQualityByWorld) => (isHebrew ? w.worldLabelHe : w.worldLabelEn);
  const rows = quality.data ?? [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={quality.isFetching} onRefresh={() => { void quality.refetch(); }} />}
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
        filterButtonTestID="admin-matching-filter-button"
        filterSheetContent={(
          <FilterSection<number>
            options={WINDOWS.map((w) => ({ value: w.days, label: t.windows[w.key] }))}
            value={days}
            onChange={(v) => setDays(v ?? 30)}
            showAllChip={false}
          />
        )}
      />

      {quality.isError ? <Text style={styles.error}>{t.error}</Text> : null}
      {!quality.isLoading && !quality.isError && rows.length === 0 ? <AdminListEmpty title={t.empty} hint="" /> : null}

      {rows.map((w) => (
        <View key={w.worldSlug} style={styles.card}>
          <Text style={styles.cardTitle}>{worldLabel(w)}</Text>
          <View style={styles.kpiGrid}>
            <Kpi label={t.metrics.notified} value={String(w.notifiedPairs)} />
            <Kpi label={t.metrics.precision} value={formatAdminPercent(w.precisionProxy)} hint={t.counts(w.accepted, w.responses)} />
            <Kpi label={t.metrics.chat} value={formatAdminPercent(w.chatRate)} hint={t.pairs(w.chatPairs)} />
            <Kpi
              label={t.metrics.completion}
              value={formatAdminPercent(w.completionRate)}
              hint={w.completedPairs === null ? t.notTracked : t.pairs(w.completedPairs)}
            />
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
