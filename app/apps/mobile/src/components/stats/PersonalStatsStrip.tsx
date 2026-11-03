// Personal stat counters — FR-STATS-001 AC1 (three counters).
// Visual treatment matches Karma tokens (warm orange, compact row for all platforms).

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';

type Props = {
  readonly given: number;
  readonly received: number;
  readonly active: number;
  readonly loading: boolean;
  readonly labels: { given: string; received: string; active: string };
};

function Cell({
  value,
  label,
  accent,
  loading,
}: {
  value: number;
  label: string;
  accent: string;
  loading: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.cell, { borderTopColor: accent }]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
      ) : (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export function PersonalStatsStrip({ given, received, active, loading, labels }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Cell value={given} label={labels.given} accent={colors.primary} loading={loading} />
      <Cell value={received} label={labels.received} accent={colors.secondary} loading={loading} />
      <Cell value={active} label={labels.active} accent={colors.success} loading={loading} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  cell: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,

    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    borderRadius: radius.md,
    borderTopWidth: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loader: { marginVertical: spacing.sm },
}));
