// Mapped to spec: FR-IMPORT-010 AC4 — the admin statistics show the external post import: the
// funnel of the period and, per draft field, the share of published imports whose member fixed it
// (`import_field_edit_rate`). A field members keep fixing is a field the extraction gets wrong.
import React from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { ImportFunnel } from '@kc/application';
import { getImportTelemetryUseCase } from '../../services/importComposition';
import { useLocaleBundle } from '../../i18n/useLocaleBundle';
import { textAlignStart } from '../../lib/rtlLayout';
import { valueOrNull } from '../../lib/backendAvailability';
import { formatAdminPercent } from './formatAdminPercent';

type Strings = ReturnType<typeof useLocaleBundle>['admin']['stats']['imports'];
type FieldKey = keyof Strings['fields'];

/** The funnel stages in reading order. */
const FUNNEL_KEYS = ['attempts', 'drafted', 'published', 'discarded', 'manual', 'providerCalls'] as const satisfies readonly (keyof ImportFunnel)[];

const isFieldKey = (t: Strings, name: string): name is FieldKey => name in t.fields;

const useStyles = makeUseStyles(({ colors }) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  title: { ...typography.bodyLarge, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  muted: { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  kpi: {
    flexGrow: 1, flexBasis: 120, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  kpiValue: { ...typography.h3, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  kpiLabel: { ...typography.bodySmall, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
}));

export function AdminImportTelemetry({ days }: { readonly days: number }) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.stats.imports;
  const telemetry = useQuery({
    queryKey: ['admin.stats.imports', days],
    // A backend without the import functions yet (not deployed) reads as "no section", not an error.
    queryFn: () => valueOrNull(() => getImportTelemetryUseCase().execute(days)),
    staleTime: 60_000,
  });
  // The section is extra to the world funnel: while it loads, or without its backend, it is not there.
  if (!telemetry.data) return null;
  const { funnel, fieldEditRates } = telemetry.data;

  const kpi = (label: string, value: string, testID: string) => (
    <View key={testID} style={styles.kpi} testID={testID}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
  return (
    <View style={styles.card} testID="admin-stats-imports">
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.muted}>{funnel.attempts === 0 ? t.empty : t.subtitle}</Text>
      {funnel.attempts > 0 ? (
        <>
          <View style={styles.grid}>
            {FUNNEL_KEYS.map((key) => kpi(t.metrics[key], String(funnel[key]), `admin-stats-imports-${key}`))}
          </View>
          <Text style={styles.title}>{t.editRates}</Text>
          <View style={styles.grid}>
            {fieldEditRates.filter((r) => isFieldKey(t, r.field)).map((r) =>
              kpi(t.fields[r.field as FieldKey], formatAdminPercent(r.editRate), `admin-stats-imports-rate-${r.field}`),
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}
