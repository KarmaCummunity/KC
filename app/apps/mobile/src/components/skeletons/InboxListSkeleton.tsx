// Loading placeholder for the chat inbox. Mirrors InboxChatRow (48px avatar +
// time/name header + preview line) so the list doesn't flash an empty "no
// chats" state before the store hydrates.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, Skeleton } from '@kc/ui';

const InboxRowSkeleton = React.memo(function InboxRowSkeleton() {
  const styles = useStyles();
  return (
    <View testID="inbox-row-skeleton" style={styles.row}>
      <Skeleton width={48} height={48} radius={24} />
      <View style={styles.info}>
        <Skeleton width="45%" height={13} radius={6} />
        <Skeleton width="80%" height={11} radius={5} />
      </View>
    </View>
  );
});

export function InboxListSkeleton({ count = 8 }: { count?: number }) {
  const styles = useStyles();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View key={`inbox-${i}`}>
          <InboxRowSkeleton />
          {i < count - 1 ? <View style={styles.sep} /> : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  info: { flex: 1, gap: spacing.xs },
  sep: { height: 1, backgroundColor: colors.border, marginEnd: spacing.base },
}));
