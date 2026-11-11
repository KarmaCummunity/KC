// What a press on a bottom-bar / navigation-rail tab should do, shared by
// TabBar (mobile) and NavigationRail (desktop) so both shells behave the same.
// Re-tapping the tab you are already on must never push a second copy of its
// screen: that re-mounts it and replays its entry animation (#1633).
// Mapped to: SRS §6.1 (5 tabs, D-16), FR-PROFILE-001 AC4.
import type { Href } from 'expo-router';
import { resolveActiveTabKey, type TabDefinition } from './tabs.config';
import { closeCreateForm } from '../../navigation/closeCreateForm';

/**
 * - `stay`      — the tab is active and its root screen is on top: keep it mounted as is.
 * - `popToRoot` — the tab is active but a nested screen is on top: unwind to the tab root
 *                 (the root stays mounted underneath, so nothing re-mounts).
 * - `close`     — the composer ("+") is active, i.e. its create form is open: the press closes it.
 * - `open`      — another tab, or a root-level screen over the tabs: navigate to the tab.
 */
export type TabPressAction = 'stay' | 'popToRoot' | 'close' | 'open';

/** Route segments that carry no screen depth: the tabs group and a trailing `index`. */
const DEPTHLESS_SEGMENTS: ReadonlySet<string> = new Set(['(tabs)', 'index']);

/** Number of screen segments in a trail, ignoring the tabs group and `index` leaves. */
function screenDepth(segments: readonly string[]): number {
  return segments.filter((segment) => !DEPTHLESS_SEGMENTS.has(segment)).length;
}

/** Decides the press outcome from the tab and the current expo-router segment trail. */
export function resolveTabPressAction(
  tab: TabDefinition,
  segments: readonly string[],
): TabPressAction {
  if (resolveActiveTabKey(segments) !== tab.key) return 'open';
  // A tab's root depth is its own route depth: 0 for home (`/(tabs)`), 1 for named tabs.
  const rootDepth = screenDepth(tab.route.split('/').filter(Boolean));
  if (screenDepth(segments) > rootDepth) return 'popToRoot';
  // The composer's root screen is the create form: "+" toggles it closed (FR-POST-001).
  return tab.isComposer ? 'close' : 'stay';
}

/** The router surface the re-tap handler needs (a subset of expo-router's `Router`). */
export interface TabRepressRouter {
  dismissTo: (href: Href) => void;
  back: () => void;
  canGoBack: () => boolean;
}

/**
 * Handles a press on the already-active tab. Returns `true` when the press was
 * fully handled here; `false` means the caller should open the tab itself.
 */
export function handleActiveTabRepress(
  router: TabRepressRouter,
  tab: TabDefinition,
  segments: readonly string[],
): boolean {
  const action = resolveTabPressAction(tab, segments);
  if (action === 'stay') return true;
  if (action === 'close') {
    closeCreateForm(router);
    return true;
  }
  if (action === 'popToRoot') {
    router.dismissTo(tab.route);
    return true;
  }
  return false;
}
