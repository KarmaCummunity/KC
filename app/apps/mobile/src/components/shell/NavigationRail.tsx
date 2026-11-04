import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, useBreakpoint, useTheme, spacing, shellDimensions, radius, typography, iconSize, Text } from '@kc/ui';
import { TABS, isTabActive, type TabDefinition } from './tabs.config';
import { handleActiveTabRepress } from './tabPress';

type NavigationRailProps = {
  /** When true, render icon + label rows. When false, icon-only column. */
  expanded?: boolean;
};

export function NavigationRail({ expanded }: NavigationRailProps) {
  const bp = useBreakpoint();
  const { colors } = useTheme();
  const styles = useStyles();
  const isExpanded = expanded ?? (bp === 'desktop' || bp === 'wide');

  return (
    <View
      style={[
        styles.container,
        isExpanded ? styles.expanded : styles.collapsed,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <ScrollView>
        {TABS.map((tab) => (
          <NavigationRailItem key={tab.key} tab={tab} expanded={isExpanded} />
        ))}
      </ScrollView>
    </View>
  );
}

function NavigationRailItem({ tab, expanded }: { tab: TabDefinition; expanded: boolean }) {
  const router = useRouter();
  const segments = useSegments();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const active = isTabActive(tab, segments as string[]);
  const iconName = active ? tab.iconActive : tab.iconInactive;
  const activeBg = (colors as { surfaceVariant?: string }).surfaceVariant ?? colors.surface;

  return (
    <Pressable
      onPress={() => {
        // Same re-tap rule as the bottom TabBar: never push a duplicate of the active tab (#1633).
        if (handleActiveTabRepress(router, tab, segments as string[])) return;
        router.push(tab.route);
      }}
      style={[
        styles.item,
        expanded ? styles.itemExpanded : styles.itemCollapsed,
        active && { backgroundColor: activeBg },
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={t(tab.labelI18nKey)}
    >
      <Ionicons name={iconName} size={iconSize['2xl']} color={active ? colors.primary : colors.textSecondary} />
      {expanded && (
        <Text style={[styles.label, { color: active ? colors.primary : colors.textPrimary }]}>
          {t(tab.labelI18nKey)}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeUseStyles(() => ({
  container: {
    borderStartWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  expanded: { width: shellDimensions.railExpanded },
  collapsed: { width: shellDimensions.railCollapsed },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginVertical: spacing.xs,
    marginHorizontal: spacing.xs,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  itemExpanded: { justifyContent: 'flex-start' },
  itemCollapsed: { justifyContent: 'center' },
  label: { ...typography.body, ...typography.medium },
}));
