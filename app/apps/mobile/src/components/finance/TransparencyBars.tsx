// FR-FIN-022 — tiny bar primitives for the public transparency section (no chart library).
import React from 'react';
import { View } from 'react-native';
import type { TransparencyMonth } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';

/** Horizontal share bar: `ratio` is clamped to 0..1. */
export function ShareBar({ ratio, tone = 'primary' }: { ratio: number; tone?: 'primary' | 'success' }) {
  const styles = useStyles();
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <View style={styles.track} accessible={false}>
      <View style={[styles.fill, tone === 'success' ? styles.fillSuccess : styles.fillPrimary, { width: `${pct}%` }]} />
    </View>
  );
}

const CHART_HEIGHT = 72;
const BAR_WIDTH = 6;

/** Paired income / expense columns, scaled to the largest value in the window. */
export function MonthlyBars({ months, a11yLabel }: { months: readonly TransparencyMonth[]; a11yLabel: string }) {
  const styles = useStyles();
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.expenseCents]));
  const h = (cents: number) => Math.max(cents > 0 ? 2 : 0, Math.round((cents / max) * CHART_HEIGHT));
  return (
    <View style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={a11yLabel}>
      {months.map((m) => (
        <View key={m.month} style={styles.col}>
          <View style={styles.pair}>
            <View style={[styles.bar, styles.income, { height: h(m.incomeCents) }]} />
            <View style={[styles.bar, styles.expense, { height: h(m.expenseCents) }]} />
          </View>
          <Text style={styles.monthLabel}>{m.month.slice(5)}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  track: { height: 8, borderRadius: radius.full, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.full },
  fillPrimary: { backgroundColor: colors.primary },
  fillSuccess: { backgroundColor: colors.success },
  chart: { flexDirection: rowDirectionStart, alignItems: 'flex-end', gap: spacing.xs },
  col: { flex: 1, alignItems: 'center', gap: spacing.xs },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: CHART_HEIGHT },
  bar: { width: BAR_WIDTH, borderRadius: radius.xs },
  income: { backgroundColor: colors.success },
  expense: { backgroundColor: colors.error },
  monthLabel: { ...typography.caption, color: colors.textSecondary },
}));
