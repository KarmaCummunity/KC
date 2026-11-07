import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSegments } from 'expo-router';
import { makeUseStyles, useBreakpoint, useTheme, spacing, shellDimensions, AsidePanel, AsideProvider, type BreakpointToken } from '@kc/ui';
import { NavigationRail } from './NavigationRail';

type ShellVariant = 'wide' | 'narrow';

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

  const isWebDesktop = Platform.OS === 'web' && bp !== 'mobile';
  if (!isWebDesktop) {
    return <AsideProvider>{children}</AsideProvider>;
  }

  const contentMax = pickContentMax(bp, variant);
  const showAside = bp === 'desktop' || bp === 'wide';

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
        <NavigationRail />
      </View>
    </AsideProvider>
  );
}

function useDetectedVariant(): ShellVariant {
  const segments = useSegments() as string[];
  // Form-style routes use the narrow variant (~600px content cap).
  // Each entry below is a segment that appears literally in expo-router's
  // useSegments() output for that route. Update this list as screens declare
  // unstable_settings.shellVariant in PRs 2-5.
  const narrowSegments = ['settings', 'edit-profile', 'edit-post', 'edit-listing', 'create', '(auth)', '(onboarding)'];
  if (narrowSegments.some((s) => segments.includes(s))) return 'narrow';
  // auth/verify and auth/callback live under the bare 'auth' segment (not (auth) group).
  if (segments.includes('auth') && (segments.includes('verify') || segments.includes('callback'))) {
    return 'narrow';
  }
  return 'wide';
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
