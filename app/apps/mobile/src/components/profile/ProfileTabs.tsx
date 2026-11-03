// app/apps/mobile/src/components/profile/ProfileTabs.tsx
// Open / closed tabs row. Used by My Profile open + closed routes.
// Mapped to: FR-PROFILE-001 AC4. Saved / hidden / removed lists use the profile stack header.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';

/** Tabs shown in the strip (two lanes per FR-PROFILE-001 AC4). */
/** Open / closed lane highlighted in the tab strip under the profile card. */
export type ProfilePostsTab = 'open' | 'closed';

export function ProfileTabs({
  active,
  onChange,
  openCount,
  closedCount,
}: {
  active: ProfilePostsTab;
  onChange: (t: ProfilePostsTab) => void;
  openCount?: number;
  closedCount?: number;
}) {
  const styles = useProfileTabsStyles();
  const { t } = useTranslation();
  const openLabel =
    openCount !== undefined
      ? t('profile.tabOpenWithCount', { count: openCount })
      : t('profile.tabOpen');
  const closedLabel =
    closedCount !== undefined
      ? t('profile.tabClosedWithCount', { count: closedCount })
      : t('profile.tabClosed');
  return (
    <View style={styles.row}>
      <Tab label={openLabel} active={active === 'open'} onPress={() => onChange('open')} styles={styles} />
      <Tab label={closedLabel} active={active === 'closed'} onPress={() => onChange('closed')} styles={styles} />
    </View>
  );
}

function Tab({
  label, active, onPress, styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof useProfileTabsStyles>;
}) {
  return (
    <TouchableOpacity style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const useProfileTabsStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row' as const,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center' as const,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary },
  text: { ...typography.button, color: colors.textSecondary, textAlign: 'center' as const },
  textActive: { color: colors.primary },
}));
