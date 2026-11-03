// Loading placeholder for the post grids (home feed + profile). Mirrors the
// PostCardGrid layout (image block + author + title + footer) so the switch to
// real cards doesn't jump. Replaces the bare spinner that left the grid blank.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { makeUseStyles, radius, spacing, Skeleton } from '@kc/ui';
import { chunkArray } from '../../lib/chunkArray';

const PostCardSkeleton = React.memo(function PostCardSkeleton({ dense }: { dense: boolean }) {
  const styles = useStyles();
  return (
    <View testID="post-card-skeleton" style={[styles.card, dense && styles.cardDense]}>
      <Skeleton width="100%" height={dense ? 96 : 140} radius={0} />
      <View style={styles.content}>
        {!dense ? (
          <View style={styles.authorRow}>
            <Skeleton width={18} height={18} radius={9} />
            <Skeleton width={72} height={10} radius={5} />
          </View>
        ) : null}
        <Skeleton width="88%" height={dense ? 10 : 12} radius={5} />
        <Skeleton width="55%" height={dense ? 10 : 12} radius={5} />
        <View style={styles.footer}>
          <Skeleton width={dense ? 40 : 52} height={9} radius={4} />
          <Skeleton width={dense ? 24 : 32} height={9} radius={4} />
        </View>
      </View>
    </View>
  );
});

export function PostGridSkeleton({
  columns,
  count = 6,
}: {
  columns: number;
  /** Number of placeholder cards to render. */
  count?: number;
}) {
  const styles = useStyles();
  const dense = columns >= 3;
  const rows = useMemo(
    () => chunkArray(Array.from({ length: count }, (_, i) => i), columns),
    [count, columns],
  );
  return (
    <View style={styles.grid} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((cell) => (
            <View key={`card-${cell}`} style={styles.cell}>
              <PostCardSkeleton dense={dense} />
            </View>
          ))}
          {/* keep last row aligned when it isn't full */}
          {row.length < columns
            ? Array.from({ length: columns - row.length }, (_, i) => (
                <View key={`spacer-${i}`} style={styles.cell} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  grid: {
    width: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: spacing.base,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    width: '100%',
    alignSelf: 'stretch',
  },
  cell: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
  },
  cardDense: {},
  content: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
}));
