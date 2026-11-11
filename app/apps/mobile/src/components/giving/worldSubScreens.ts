// Mapped to spec: FR-FEED-020 AC2 — the world's own sub-screens linked from its header.
import type { WorldSubScreenLink } from './WorldHubHeader';

/**
 * "My handoffs" of a world plus the member's own listings (every world's listings, D70),
 * followed by the world's own screens (`extra`, e.g. the time world's shifts).
 */
export function worldSubScreens(
  handoffsPath: WorldSubScreenLink['path'],
  extra: readonly WorldSubScreenLink[] = [],
): readonly WorldSubScreenLink[] {
  return [
    { labelKey: 'givingHandoff.myHandoffs', path: handoffsPath, testID: 'world-hub-my-handoffs' },
    { labelKey: 'marketplace.myListingsNav', path: '/(tabs)/donations/marketplace/my-listings', testID: 'world-hub-my-listings' },
    ...extra,
  ];
}

/** Link to the world's "links and knowledge" sub-screen (#1963). */
export function worldLinksSubScreenLink(worldSlug: string): WorldSubScreenLink {
  return {
    labelKey: 'donations.worldLinksNav',
    path: `/(tabs)/donations/${worldSlug}/links` as WorldSubScreenLink['path'],
    testID: `world-hub-${worldSlug}-links`,
  };
}
