import { useGlobalSearchParams, useSegments, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@kc/ui';
import { useAuthStore } from '../store/authStore';
import { parseTruthyQueryParam } from '../lib/query/parseTruthyQueryParam';
import { isAboutMarketingPath } from './aboutMarketingPaths';
import { shellTabBarHiddenForSegments } from './shellChromePolicy';

// Visual height of the floating pill (see TabBar.tsx TAB_BAR_HEIGHT = 48, slimmed in #1631).
// Scroll padding adds this plus safe-area insets separately.
const TAB_BAR_HEIGHT = 48;

/** Whether the global shell should render the bottom tab bar + reserve padding. */
export function useShellTabBarVisibility(): boolean {
  const segments = useSegments() as string[];
  const pathname = usePathname() ?? '';
  const params = useGlobalSearchParams<{ hideBottomBar?: string | string[] }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  const head = segments[0] as string | undefined;
  const onAboutSurface = isAboutMarketingPath(pathname);
  const onResearchSurface = head === 'research';
  const hideBottomBar = onAboutSurface && parseTruthyQueryParam(params.hideBottomBar);

  const base =
    !isLoading &&
    isAuthenticated &&
    head !== '(auth)' &&
    head !== '(guest)' &&
    head !== '(onboarding)' &&
    !onResearchSurface &&
    !shellTabBarHiddenForSegments(segments);

  return base && !hideBottomBar;
}

export function shellTabBarHeightPx(visible: boolean): number {
  return visible ? TAB_BAR_HEIGHT : 0;
}

/** Bottom inset for scroll content above the floating shell tab bar. */
export function useShellTabBarScrollInset(extraBottom: number = spacing.lg): number {
  const insets = useSafeAreaInsets();
  return extraBottom + shellTabBarHeightPx(useShellTabBarVisibility()) + insets.bottom;
}
