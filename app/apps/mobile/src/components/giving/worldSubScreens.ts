// Mapped to spec: FR-FEED-020 AC2 — the world's own sub-screens linked from its header.
import type { WorldSubScreenLink } from './WorldHubHeader';

/** "My handoffs" of a world plus the member's own listings (every world's listings, D70). */
export function worldSubScreens(handoffsPath: WorldSubScreenLink['path']): readonly WorldSubScreenLink[] {
  return [
    { labelKey: 'givingHandoff.myHandoffs', path: handoffsPath, testID: 'world-hub-my-handoffs' },
    { labelKey: 'marketplace.myListingsNav', path: '/(tabs)/donations/marketplace/my-listings', testID: 'world-hub-my-listings' },
  ];
}
