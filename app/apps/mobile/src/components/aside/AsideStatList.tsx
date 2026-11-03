// Shared stat-row list for the desktop stats asides (FR-RESP-003).
// CommunityStatsAside and ProfileStatsAside render an identical
// {label, value} row idiom — keep it in one place.
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';

export type AsideStatRow = {
  key: string;
  label: string;
  value: number | undefined;
};

type AsideStatListProps = {
  rows: ReadonlyArray<AsideStatRow>;
  /** testID prefix per row: `${testIDPrefix}-${row.key}`. */
  testIDPrefix: string;
};

export function AsideStatList({ rows, testIDPrefix }: AsideStatListProps) {
  const styles = useStyles();
  return (
    <>
      {rows.map((row) => (
        <View key={row.key} style={styles.row} testID={`${testIDPrefix}-${row.key}`}>
          <Text style={styles.value}>{row.value ?? '—'}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {row.label}
          </Text>
        </View>
      ))}
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'baseline' as const,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  value: {
    ...typography.h4,
    color: colors.primary,
    minWidth: 36,
    textAlign: rtlTextAlignStart,
  },
  label: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    textAlign: rtlTextAlignStart,
  },
}));
