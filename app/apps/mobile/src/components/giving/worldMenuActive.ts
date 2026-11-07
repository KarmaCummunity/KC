// FR-FEED-020 AC2 — which world sub-screen is active (TopBar title + menu checkmark).
import type { Href } from 'expo-router';
import type { WorldSubScreenLink } from './WorldHubHeader';

const MY_LISTINGS_SEGMENT = '/marketplace/my-listings';
const MAP_SEGMENT = '/marketplace/map';

export const WORLD_MAP_MENU_ID = 'world-map' as const;

export function normalizeExpoPath(pathname: string): string {
  return pathname.replace(/\/\([^)/]+\)/g, '').replace(/\/$/, '') || '/';
}

export function hrefPath(href: Href): string {
  if (typeof href === 'string') return normalizeExpoPath(href);
  const path = href.pathname;
  return normalizeExpoPath(typeof path === 'string' ? path : '');
}

function queryWorld(worldQuery: string | string[] | undefined): string | null {
  if (typeof worldQuery === 'string' && worldQuery.length > 0) return worldQuery;
  if (Array.isArray(worldQuery) && worldQuery[0]) return worldQuery[0];
  return null;
}

/** Menu row testID for the active screen, or internal map id for scoped map title. */
export function resolveActiveWorldMenuItem(args: Readonly<{
  pathname: string;
  worldQuery?: string | string[] | undefined;
  worldSlug: string;
  feedPath: Href;
  subScreens: readonly WorldSubScreenLink[];
}>): 'world-menu-feed' | typeof WORLD_MAP_MENU_ID | string | null {
  const path = normalizeExpoPath(args.pathname);
  const feed = hrefPath(args.feedPath);
  const worldQ = queryWorld(args.worldQuery);

  for (const link of args.subScreens) {
    if (link.testID === 'world-hub-my-listings') {
      if (path.includes(MY_LISTINGS_SEGMENT) && worldQ === args.worldSlug) {
        return link.testID;
      }
      continue;
    }
    const linkPath = hrefPath(link.path);
    if (path === linkPath || path.startsWith(`${linkPath}/`)) {
      return link.testID;
    }
  }

  if (path.includes(MAP_SEGMENT) && worldQ === args.worldSlug) {
    return WORLD_MAP_MENU_ID;
  }

  if (path === feed) {
    return 'world-menu-feed';
  }

  return null;
}

export function screenLabelKeyForMenuItem(
  item: 'world-menu-feed' | typeof WORLD_MAP_MENU_ID | string,
  subScreens: readonly WorldSubScreenLink[],
): string {
  if (item === 'world-menu-feed') return 'donations.worldFeed.feedTab';
  if (item === WORLD_MAP_MENU_ID) return 'feed.openMapA11y';
  const link = subScreens.find((s) => s.testID === item);
  return link?.labelKey ?? 'donations.worldFeed.feedTab';
}
