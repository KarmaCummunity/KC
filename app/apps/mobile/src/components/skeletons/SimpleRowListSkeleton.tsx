import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, radius, Skeleton } from '@kc/ui';

type Props = {
  readonly rows?: number;
  readonly rowHeight?: number;
};

export function SimpleRowListSkeleton({ rows = 8, rowHeight = 56 }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="simple-row-list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} style={[styles.row, { height: rowHeight }]} />
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { padding: spacing.base, gap: spacing.sm },
  row: {
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
}));
