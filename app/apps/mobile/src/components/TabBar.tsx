// Floating glass-pill bottom navigation — rendered once at the root layout
// (ShellWithTabBar). The visible bar lives here; expo-router's <Tabs> in
// (tabs)/_layout.tsx suppresses its built-in bar so there is exactly one
// implementation across iOS / Android / Web.
// Mapped to: SRS §6.1 — 5 tabs (RTL: Profile | Search | Plus | Donations | Home), per D-16.
import React from 'react';
import { Animated, Easing, Platform, Pressable, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, shadow, spacing, useTheme } from '@kc/ui';
import { TABS, resolveActiveTabKey, type IoniconName } from './shell/tabs.config';
import { TAB_PLUS_DIAMETER_PX, TAB_PLUS_LIFT_PX } from './shell/tabBarGeometry';
import { handleActiveTabRepress } from './shell/tabPress';
import { createCategoryForPath, createRouteFor } from '../lib/unifiedCreate/createCategories';
import { useReducedMotion } from '../hooks/useReducedMotion';

const PLUS_TURN_MS = 220;

// Glassmorphism on web — RN-Web forwards unknown style keys to CSS. RN's
// ViewStyle type doesn't include backdrop-filter, so cast through unknown.
const webGlass: ViewStyle =
  Platform.OS === 'web'
    ? ({
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      } as unknown as ViewStyle)
    : ({} as ViewStyle);

// Slim bar (#1631): icon row only, no extra space above or below the icons.
export const TAB_BAR_HEIGHT = 48;

interface IconBtnProps {
  active: boolean;
  onPress: () => void;
  label: string;
  /** Stable E2E selector (`tab-<key>`), independent of the UI language (KC#1235). */
  testID: string;
  iconActive: IoniconName;
  iconInactive: IoniconName;
}

function IconBtn({ active, onPress, label, testID, iconActive, iconInactive }: IconBtnProps) {
  const styles = useTabBarStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tabBtn, pressed && styles.tabBtnPressed]}
    >
      <View style={[styles.iconSlot, active && styles.iconSlotActive]}>
        <Ionicons
          key={active ? iconActive : iconInactive}
          name={active ? iconActive : iconInactive}
          size={active ? 24 : 22} // brand-guard-allow: active tab glyph grows past the icon scale
          color={active ? colors.tabActive : colors.tabInactive}
        />
      </View>
    </Pressable>
  );
}

interface PlusBtnProps {
  active: boolean;
  onPress: () => void;
  label: string;
  testID: string;
}

function PlusBtn({ active, onPress, label, testID }: PlusBtnProps) {
  const styles = useTabBarStyles();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  // `active` means the create form is open: turn the "+" an eighth turn (45°) so it reads as "×".
  const turn = React.useRef(new Animated.Value(active ? 1 : 0)).current;
  React.useEffect(() => {
    const animation = Animated.timing(turn, {
      toValue: active ? 1 : 0,
      duration: reducedMotion ? 0 : PLUS_TURN_MS,
      easing: Easing.out(Easing.cubic),
      // RN-Web has no native animation driver.
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [active, reducedMotion, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tabBtn, pressed && styles.tabBtnPressed]}
    >
      <View style={[styles.plusCircle, active && styles.plusCircleActive]}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons
            name="add"
            size={25} // brand-guard-allow: centre action glyph sized to its 60pt button
            color={colors.textInverse}
          />
        </Animated.View>

      </View>
    </Pressable>
  );
}

export function TabBar({ bottomInset = 0 }: Readonly<{ bottomInset?: number }> = {}) {
  const router = useRouter();
  const { t } = useTranslation();
  const segments = useSegments() as string[];
  const pathname = usePathname();
  const active = resolveActiveTabKey(segments);
  const styles = useTabBarStyles();

  return (
    <View
      testID="shell-tab-bar"
      style={[styles.tabBar, { height: TAB_BAR_HEIGHT + bottomInset, paddingBottom: bottomInset }]}
    >
      {/* RTL reading order: Profile (right) | Search | Plus (center) | Donations | Home (left).
          With dir=rtl on web and I18nManager.isRTL on native, default `row` lays them out
          right-to-left. `row-reverse` would double-flip on web → LTR visual.
          Tab definitions live in ./shell/tabs.config.ts so NavigationRail (Task 9) can reuse them. */}
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        const label = t(tab.labelI18nKey);
        const onPress = () => {
          // Re-tapping the active tab keeps its screen mounted (or unwinds to the tab root),
          // instead of pushing a duplicate that re-mounts and replays its entry animation (#1633).
          if (handleActiveTabRepress(router, tab, segments)) return;
          // The bar is also shown over root-level screens (post/[id], chat, ...).
          // Pushing a tab route from there leaves that screen underneath, so the
          // iOS swipe-back later jumps to it. Pop back to the tabs first — except for
          // "+", whose form opens over the current screen and returns to it (FR-POST-001 AC9).
          if (!tab.isComposer && segments[0] !== '(tabs)' && router.canDismiss()) router.dismissAll();
          // "+" opens the form on the giving world on screen (its remembered offer / request).
          router.push(tab.isComposer ? createRouteFor(createCategoryForPath(pathname)) : tab.route);
        };
        if (tab.isComposer) {
          return (
            <PlusBtn key={tab.key} active={isActive} onPress={onPress} label={label} testID={`tab-${tab.key}`} />
          );
        }
        return (
          <IconBtn
            key={tab.key}
            active={isActive}
            onPress={onPress}
            label={label}
            testID={`tab-${tab.key}`}
            iconActive={tab.iconActive}
            iconInactive={tab.iconInactive}
          />
        );
      })}
    </View>
  );
}

const useTabBarStyles = makeUseStyles(({ colors, isDark }) => ({
  tabBar: {
    flexDirection: 'row' as const,
    height: TAB_BAR_HEIGHT,
    // Docked flush with the screen bottom (#1213): only top corners rounded.
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.tabBarGlass,
    alignItems: 'center' as const,
    width: '100%' as const,
    alignSelf: 'center' as const,
    // Visible: the raised "+" button sticks out above the bar.
    overflow: 'visible' as const,
    shadowColor: colors.shadow,
    // brand-guard-allow: the floating pill has no shared shadow preset (deeper than shadow.modal)
    shadowOffset: { width: 0, height: 10 }, // brand-guard-allow: floating pill shadow
    shadowOpacity: isDark ? 0.45 : 0.14, // brand-guard-allow: floating pill shadow
    shadowRadius: 28, // brand-guard-allow: floating pill shadow
    elevation: 12, // brand-guard-allow: floating pill shadow
    // Subtle hairline so the pill reads as a distinct surface in dark mode
    // where the underlying background and the glass tint are both dark.
    borderWidth: 1,
    borderColor: colors.border,
    ...webGlass,
  },
  tabBtn: {
    flex: 1,
    height: TAB_BAR_HEIGHT,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tabBtnPressed: { opacity: 0.6 },
  iconSlot: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconSlotActive: {
    backgroundColor: colors.primarySurface,
  },
  // The centre action is taller than the 48pt bar: it rises above the bar's top edge, ringed in
  // the screen background so it reads as a separate floating button.
  plusCircle: {
    width: TAB_PLUS_DIAMETER_PX,
    height: TAB_PLUS_DIAMETER_PX,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 3,
    borderColor: colors.background,
    transform: [{ translateY: -TAB_PLUS_LIFT_PX }],
    ...shadow.glow,
  },
  plusCircleActive: { backgroundColor: colors.primaryDark },
}));
