import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSegments } from 'expo-router';
import { makeUseStyles, useBreakpoint, useTheme, spacing, shellDimensions, AsidePanel, AsideProvider, type BreakpointToken } from '@kc/ui';
import { NavigationRail } from './NavigationRail';
import { resolveShellVariant, type ShellVariant } from './shellRoute';
import { useShellNavigationRailVisibility } from '../../navigation/useShellTabBarVisibility';


type AppShellProps = {
  children: ReactNode;
  /** Override variant detection (used by screens that don't expose unstable_settings). */
  variant?: ShellVariant;
};

/**
 * Top-level composition for >=768px viewports on web.
 *
 * - Mobile (<768) OR non-web platform: passthrough wrapped in AsideProvider so
 *   useAside(...) calls from child screens are safe at every breakpoint. The
 *   mobile chrome in app/_layout.tsx renders its bottom TabBar instead. This
 *   component is never on the mobile render path until PR 2 wires it in.
 * - Tablet (768-1023): icon-only NavigationRail + <main>, no aside.
 * - Desktop / wide (>=1024): labeled NavigationRail + <main> + AsidePanel.
 * - A signed-out visitor, and the sign-in, onboarding and public research surfaces, get the
 *   main column alone: the rail leads only to member routes and the aside is filled by member
 *   screens (`useShellNavigationRailVisibility`).
 *
 * Narrow variant caps <main> at shellDimensions.contentMaxNarrow. Used by
 * form-style screens (settings, edit-profile, auth, onboarding, composer).
 */
export function AppShell({ children, variant: variantProp }: AppShellProps) {
  const bp = useBreakpoint();
  const { colors } = useTheme();
  const styles = useStyles();
  const detectedVariant = useDetectedVariant();
  const variant = variantProp ?? detectedVariant;
  const showNavigation = useShellNavigationRailVisibility();

  const isWebDesktop = Platform.OS === 'web' && bp !== 'mobile';
  if (!isWebDesktop) {
    return <AsideProvider>{children}</AsideProvider>;
  }

  const contentMax = pickContentMax(bp, variant);
  const showAside = showNavigation && (bp === 'desktop' || bp === 'wide');

  return (
    <AsideProvider>
      <View style={[styles.row, { backgroundColor: colors.background }]}>
        {showAside && (
          <View style={styles.aside}>
            <AsidePanel />
          </View>
        )}
        <View style={styles.mainOuter}>
          <View style={[styles.main, contentMax !== undefined && { maxWidth: contentMax }]}>
            {children}
          </View>
        </View>
        {showNavigation && <NavigationRail />}
      </View>
    </AsideProvider>
  );
}

/** The variant of the current route; `shellRoute.ts` holds which routes are forms. */
function useDetectedVariant(): ShellVariant {
  return resolveShellVariant(useSegments() as string[]);
}

function pickContentMax(bp: BreakpointToken, variant: ShellVariant): number | undefined {
  if (variant === 'narrow') return shellDimensions.contentMaxNarrow;
  if (bp === 'wide') return shellDimensions.contentMaxWide;
  if (bp === 'desktop') return shellDimensions.contentMaxDesktop;
  if (bp === 'tablet') return shellDimensions.contentMaxTablet;
  return undefined;
}

const useStyles = makeUseStyles(() => ({
  row: { flex: 1, flexDirection: 'row' },
  aside: { padding: spacing.base, justifyContent: 'flex-start' },
  mainOuter: { flex: 1, alignItems: 'center' },
  main: { flex: 1, width: '100%', minWidth: 0, overflow: 'hidden' as const },
}));
