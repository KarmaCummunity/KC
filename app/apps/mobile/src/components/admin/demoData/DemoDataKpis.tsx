// FR-ADMIN-031 AC1 — the counts of the Demo data screen: what the wipe would delete.
import { View } from 'react-native';
import type { DemoDataStatus } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { textAlignStart } from '../../../lib/rtlLayout';

export function DemoDataKpis({ status }: { readonly status: DemoDataStatus }) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.demoData;
  const tiles: readonly (readonly [string, number])[] = [
    [t.users, status.demoUsers],
    [t.organizations, status.demoOrganizations],
    [t.itemPosts, status.demoItemPosts],
    [t.ridePosts, status.demoRidePosts],
    [t.follows, status.demoFollows],
    [t.chats, status.demoChats],
    [t.orgMemberships, status.demoOrgMemberships],
  ];
  return (
    <View style={styles.row}>
      {tiles.map(([label, value]) => (
        <View key={label} style={styles.tile}>
          <Text style={styles.value}>{String(value)}</Text>
          <Text style={styles.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1, flexBasis: 140, minWidth: 120, backgroundColor: colors.background, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  value: { fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  label: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
}));
