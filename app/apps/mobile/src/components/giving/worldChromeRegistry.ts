// FR-FEED-020 AC2 — single source for a world's feed route and TopBar sub-screen menu links.
import type { Href } from 'expo-router';
import type { WorldSubScreenLink } from './WorldHubHeader';
import { worldLinksSubScreenLink, worldSubScreens } from './worldSubScreens';

export const MY_LISTINGS_PATH = '/(tabs)/donations/marketplace/my-listings' as const;

export type WorldChromeConfig = Readonly<{
  readonly feedPath: Href;
  readonly subScreens: readonly WorldSubScreenLink[];
}>;

/** World slug → feed path + the same sub-screen links as on the world's hub. */
export const WORLD_CHROME_BY_SLUG: Record<string, WorldChromeConfig> = {
  items: {
    feedPath: '/(tabs)/donations/items',
    subScreens: worldSubScreens('/(tabs)/donations/items/handoffs'),
  },
  food: {
    feedPath: '/(tabs)/donations/food',
    subScreens: worldSubScreens('/(tabs)/donations/food/handoffs', [
      worldLinksSubScreenLink('food'),
    ]),
  },
  animals: {
    feedPath: '/(tabs)/donations/animals',
    subScreens: worldSubScreens('/(tabs)/donations/animals/handoffs', [
      worldLinksSubScreenLink('animals'),
    ]),
  },
  housing: {
    feedPath: '/(tabs)/donations/housing',
    subScreens: worldSubScreens('/(tabs)/donations/housing/handoffs', [
      { labelKey: 'housingStay.myHosting.nav', path: '/(tabs)/donations/housing/hosting', testID: 'world-hub-housing-hosting' },
      { labelKey: 'housingStay.myStays.nav', path: '/(tabs)/donations/housing/stays', testID: 'world-hub-housing-stays' },
      worldLinksSubScreenLink('housing'),
    ]),
  },
  time: {
    feedPath: '/(tabs)/donations/time',
    subScreens: worldSubScreens('/(tabs)/donations/time/handoffs', [
      { labelKey: 'timeVolunteer.myShiftsLink', path: '/(tabs)/donations/time/my-shifts', testID: 'time-my-shifts' },
      { labelKey: 'timeVolunteer.organizerLink', path: '/(tabs)/donations/time/organizer', testID: 'time-organizer' },
      { labelKey: 'timeVolunteer.contactKcLink', path: '/(tabs)/donations/time/support', testID: 'time-contact-kc' },
      worldLinksSubScreenLink('time'),
    ]),
  },
  knowledge: {
    feedPath: '/(tabs)/donations/knowledge',
    subScreens: worldSubScreens('/(tabs)/donations/knowledge/handoffs', [
      worldLinksSubScreenLink('knowledge'),
    ]),
  },
  rides: {
    feedPath: '/(tabs)/donations/rides',
    subScreens: worldSubScreens('/(tabs)/donations/rides/handoffs', [
      { labelKey: 'rideSeries.mine', path: '/(tabs)/donations/rides/series', testID: 'world-hub-ride-series' },
      worldLinksSubScreenLink('rides'),
    ]),
  },
};

export function worldFeedPath(worldSlug: string): Href {
  const path = `/(tabs)/donations/${worldSlug}`;
  return path as Href;
}

export function resolveWorldChrome(worldSlug: string | undefined | null): WorldChromeConfig | null {
  if (!worldSlug) return null;
  return WORLD_CHROME_BY_SLUG[worldSlug] ?? null;
}
