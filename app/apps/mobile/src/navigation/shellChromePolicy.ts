// Documented rules for global shell chrome (TopBar + floating TabBar).
// Implementation: `useShellTabBarVisibility`, `TopBar`, `TopBarStackHeader`, `useShellStackScreenOptions`.

/** Routes that hide the floating TabBar (composer overlap, public surfaces, etc.). */
export const SHELL_TAB_BAR_HIDDEN_ROUTE_PREFIXES = [
  '(auth)',
  '(guest)',
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
