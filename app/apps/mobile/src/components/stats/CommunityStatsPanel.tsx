// Community stats panel — FR-STATS-004 AC1 (flat numbers, no charts).

import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

type Props = {
  readonly users: number;
  readonly posts: number;
  readonly delivered: number;
  readonly loading: boolean;
  readonly error: boolean;
  readonly labels: {
    title: string;
    users: string;
    posts: string;
    delivered: string;
    hint: string;
    retry: string;
  };
  readonly onRetry: () => void;
};

export function CommunityStatsPanel({
  users,
  posts,
  delivered,
  loading,
  error,
  labels,
  onRetry,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{labels.title}</Text>
      </View>
      <Text style={styles.hint}>{labels.hint}</Text>

      {error ? (
        <TouchableOpacity style={styles.retryBox} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryText}>{labels.retry}</Text>
        </TouchableOpacity>
      ) : loading && users === 0 && posts === 0 && delivered === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <View style={styles.card}>
          <Row label={labels.users} value={users} />
          <Row label={labels.posts} value={posts} />
          <Row label={labels.delivered} value={delivered} last />
        </View>
      )}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: number; last?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  title: { ...typography.h4, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignStart },
  card: {
    backgroundColor: colors.primarySurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  rowValue: { ...typography.h4, color: colors.textPrimary, marginStart: spacing.base },
  loader: { paddingVertical: spacing.lg },
  retryBox: {
    padding: spacing.base,
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
  },
  retryText: { ...typography.body, color: colors.error },
}));
