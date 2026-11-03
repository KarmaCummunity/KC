// Shared canonical tab definitions consumed by both the mobile bottom
// TabBar and the upcoming desktop NavigationRail (Task 9 of FR-RESP-001).
// Keeping a single source of truth here guarantees the two shells stay in
// lockstep on order, routes, labels and iconography.
// Mapped to: SRS §6.1 — 5 tabs (RTL: Profile | Search | Plus | Donations | Home), per D-16.
import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';

export type IoniconName = keyof typeof Ionicons.glyphMap;

export type TabKey = 'home' | 'donations' | 'create' | 'search' | 'profile';

export type TabDefinition = {
  key: TabKey;
  route: Extract<Href, string>;
  labelI18nKey: string;
  iconActive: IoniconName;
  iconInactive: IoniconName;
  /** Composer ("+") is a special floating button; rail treats it the same as a labeled tab. */
  isComposer?: boolean;
};

/**
 * Canonical RTL reading order (rightmost = first / "profile").
 * Both TabBar (mobile bottom) and NavigationRail (desktop side) consume this.
 *
 * With dir=rtl on web and I18nManager.isRTL on native, a default `row` lays
 * these out right-to-left, so the array is authored in reading order:
 * Profile (right) | Search | Plus (center) | Donations | Home (left).
 */
export const TABS: readonly TabDefinition[] = [
  {
    key: 'profile',
    route: '/(tabs)/profile',
    labelI18nKey: 'tabs.profile',
    iconActive: 'person',
    iconInactive: 'person-outline',
  },
  {
    key: 'search',
    route: '/(tabs)/search',
    labelI18nKey: 'search.tabLabel',
    iconActive: 'search',
    iconInactive: 'search-outline',
  },
  {
    key: 'create',
    route: '/(tabs)/create',
    labelI18nKey: 'tabs.newPost',
    // Composer uses a single glyph regardless of active state; the special
    // pill rendering is keyed off `isComposer`.
    iconActive: 'add',
    iconInactive: 'add',
    isComposer: true,
  },
  {
    key: 'donations',
    route: '/(tabs)/donations',
    labelI18nKey: 'donations.tabLabel',
    iconActive: 'heart',
    iconInactive: 'heart-outline',
  },
  {
    key: 'home',
    route: '/(tabs)',
    labelI18nKey: 'tabs.home',
    iconActive: 'home',
    iconInactive: 'home-outline',
  },
] as const;

const NAMED_TAB_SEGMENTS = ['profile', 'search', 'donations', 'create'] as const;

/** True when `tab` matches the current expo-router segment trail. */
export function isTabActive(tab: TabDefinition, segments: readonly string[]): boolean {
  const parts = tab.route.split('/').filter(Boolean);
  const named = parts[1];

  if (!named) {
    // Home — active inside (tabs) without a named sibling, or on flat web segments.
    return !NAMED_TAB_SEGMENTS.some((segment) => segments.includes(segment));
  }

  return segments.includes(named);
}

/** Active bottom-rail / tab-bar key, or null when outside the tab navigator. */
export function resolveActiveTabKey(segments: readonly string[]): TabKey | null {
  const onTabSurface =
    segments.includes('(tabs)') ||
    NAMED_TAB_SEGMENTS.some((segment) => segments.includes(segment)) ||
    segments.includes('index') ||
    segments.length === 0;

  if (!onTabSurface) return null;

  for (const tab of TABS) {
    if (isTabActive(tab, segments)) return tab.key;
  }
  return null;
}
