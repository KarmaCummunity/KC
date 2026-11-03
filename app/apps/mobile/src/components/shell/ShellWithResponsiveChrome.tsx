import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBreakpoint, AsideProvider, useTheme } from '@kc/ui';
import { AppShell } from './AppShell';
import { TabBar } from '../TabBar';
import { EphemeralToast } from '../EphemeralToast';
import { useShellTabBarVisibility } from '../../navigation/useShellTabBarVisibility';
import { tabBarBottomOffset, tabBarBottomPadding } from './tabBarGeometry';

// TabBar geometry. The floating pill is flush with the platform safe area on
// every platform (sits directly above the iOS home indicator / Android gesture
// bar; touches the viewport bottom on web where there's no inset). Screen
// content fills the full viewport — the translucent pill floats over it so
// the user sees real content through the bar, not a reserved blank strip.

/**
 * Root-level chrome chooser (FR-RESP-002).
 *
 * - **Desktop web (≥768px)**: `AppShell` renders right-side `NavigationRail` +
 *   main column + optional `AsidePanel`. No bottom tab bar. AppShell itself
 *   provides `AsideProvider`.
 * - **Mobile (native or phone-width web, <768px)**: identical DOM to the
 *   pre-FR-RESP-002 `ShellWithTabBar` — floating bottom `TabBar` pill plus
 *   ephemeral toast. Wrapped in `AsideProvider` so screens can safely call
 *   `useAside(...)` without breakpoint guards.
 */
export function ShellWithResponsiveChrome({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const bp = useBreakpoint();
  const isWebDesktop = Platform.OS === 'web' && bp !== 'mobile';

  if (isWebDesktop) {
    return (
      <AppShell>
        <View style={{ flex: 1 }}>{children}</View>
        <EphemeralToast />
      </AppShell>
    );
  }

  return (
    <AsideProvider>
      <ShellWithMobileChrome>{children}</ShellWithMobileChrome>
    </AsideProvider>
  );
}

function ShellWithMobileChrome({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const showTabBar = useShellTabBarVisibility();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Outer wrapper carries the app background so the translucent pill reveals
  // the app surface even on routes whose own content stops short.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <EphemeralToast />
      {showTabBar && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            bottom: tabBarBottomOffset(),
            left: 0,
            right: 0,
          }}
        >
          <TabBar bottomInset={tabBarBottomPadding(insets.bottom)} />
        </View>
      )}
    </View>
  );
}
