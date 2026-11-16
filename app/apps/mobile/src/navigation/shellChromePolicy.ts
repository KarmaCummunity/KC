// Documented rules for global shell chrome (TopBar + floating TabBar + desktop NavigationRail).
// Implementation: `useShellTabBarVisibility`, `useShellNavigationRailVisibility`, `TopBar`,
// `TopBarStackHeader`, `useShellStackScreenOptions`.

/** Routes that hide the floating TabBar (composer overlap, public surfaces, etc.). */
export const SHELL_TAB_BAR_HIDDEN_ROUTE_PREFIXES = [
  '(auth)',
  '(onboarding)',
  'research',
] as const;

/** Per-segment hides (e.g. single chat thread hides the bar above the composer). */
export function shellTabBarHiddenForSegments(segments: readonly string[]): boolean {
  const head = segments[0];
  if (head === 'auth' && (segments[1] === 'callback' || segments[1] === 'verify')) return true;
  if (head === 'chat' && segments[1] === '[id]') return true;
  return false;
}

/** What the desktop navigation rail rule looks at: the session and the current route. */
export interface ShellNavigationRailState {
  /** The session is still being restored: who the visitor is, is not known yet. */
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  /** Route segments as expo-router reports them (`useSegments`). */
  readonly segments: readonly string[];
}

/**
 * Whether the desktop navigation rail is shown (FR-RESP-002, FR-RESEARCH-001 AC2).
 *
 * Every rail item leads to a member route, so a signed-out visitor never sees it, and the
 * sign-in, onboarding and public research surfaces stay free of app navigation for everyone.
 * Unlike the floating tab bar, the rail does not overlap a screen's content, so the
 * per-screen tab-bar hides (a chat thread's composer) do not apply to it.
 */
export function shellNavigationRailVisible({ isLoading, isAuthenticated, segments }: ShellNavigationRailState): boolean {
  if (isLoading || !isAuthenticated) return false;
  const head = segments[0];
  if (head !== undefined && (SHELL_TAB_BAR_HIDDEN_ROUTE_PREFIXES as readonly string[]).includes(head)) return false;
  // The sign-in return routes live under the bare `auth` segment, not the `(auth)` group.
  if (head === 'auth' && (segments[1] === 'callback' || segments[1] === 'verify')) return false;
  return true;
}
