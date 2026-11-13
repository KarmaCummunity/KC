// FR-STATS-008 — the signed-in member's own givings per world on the statistics screen:
// given, received (handed over) and own listings closed.
// Owner only by construction: the call reads the session user (FR-STATS-006 AC1) through
// `my_world_givings` (migration 0018); the block is not rendered while a backend lacks it.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { MyWorldGivings } from '@kc/application';
import { getListMyWorldGivingsUseCase } from '../../services/statsComposition';
import { valueOrNull } from '../../lib/backendAvailability';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';

export function MyWorldGivingsPanel({ userId }: { userId: string | undefined }) {
  const { t, i18n } = useTranslation();
  const styles = useStyles();
  const query = useQuery({
    queryKey: ['my-world-givings', userId],
    queryFn: () => valueOrNull(() => getListMyWorldGivingsUseCase().execute()),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  const isHebrew = i18n.language.startsWith('he');
  const worldName = (row: MyWorldGivings) => (isHebrew ? row.worldLabelHe : row.worldLabelEn);
  const rows = query.data ?? [];
  if (query.data === null) return null;

  return (
    <View style={styles.panel} testID="my-world-givings">
      <Text style={styles.title}>{t('stats.byWorldTitle')}</Text>
      {query.isLoading ? <ActivityIndicator /> : null}
      {!query.isLoading && rows.length === 0 ? <Text style={styles.empty}>{t('stats.byWorldEmpty')}</Text> : null}
      {rows.map((row) => (
        <View key={row.worldSlug} style={styles.row} testID={`my-world-givings-${row.worldSlug}`}>
          <Text style={styles.world}>{worldName(row)}</Text>
          <Count label={t('stats.byWorldGiven')} value={row.given} styles={styles} />
          <Count label={t('stats.byWorldReceived')} value={row.received} styles={styles} />
          <Count label={t('stats.byWorldClosed')} value={row.closed} styles={styles} />
        </View>
      ))}
    </View>
  );
}

function Count({ label, value, styles }: { label: string; value: number; styles: ReturnType<typeof useStyles> }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{String(value)}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  panel: {
    marginHorizontal: spacing.base,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  row: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.sm },
  world: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  count: { alignItems: 'center' as const, minWidth: 56 },
  countValue: { ...typography.h3, color: colors.textPrimary },
  countLabel: { ...typography.caption, color: colors.textSecondary },
}));
