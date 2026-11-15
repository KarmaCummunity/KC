// Rides world hub (#1626; docs/spec/05_giving_worlds.md §5.3 "Feed", D75): the screen opens on
// the rides feed — every upcoming offer and request, grouped by day, on the shared listing card.
// In the TopBar: the world's title menu of its screens, the map and the filter button, the same
// as every world. The route search and offers / requests filter sit in the filter sheet. The feed ends
// with a short list of the world's links and a button to its "links and knowledge" screen.
import React, { useCallback, useState } from 'react';
import { Screen } from '../../../components/ui/Screen';
import { WorldHubHeader } from '../../../components/giving/WorldHubHeader';
import { WORLD_CHROME_BY_SLUG } from '../../../components/giving/worldChromeRegistry';
import { WorldLinksPreview } from '../../../components/giving/WorldLinksPreview';
import { useWorldHeader } from '../../../components/giving/useWorldHeader';
import { RidesFeedFilterSheet } from '../../../components/giving/RidesFeedFilterSheet';
import { RidesFeedList } from '../../../components/giving/RidesFeedList';
import { useRidesHubFeed } from '../../../hooks/useRidesHubFeed';

export function RidesHubScreen() {
  const feed = useRidesHubFeed();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const screensMenu = useWorldHeader({
    worldSlug: 'rides',
    subScreens: WORLD_CHROME_BY_SLUG.rides.subScreens,
    activeFilterCount: feed.activeFilterCount,
    onOpenFilters: openFilters,
  });

  return (
    <Screen blobs="off" hasNativeHeader>
      <RidesFeedList
        feed={feed}
        header={<WorldHubHeader icon="car-outline" introKey="donations.rides.hubBody" />}
        footer={<WorldLinksPreview worldSlug="rides" />}
      />
      <RidesFeedFilterSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} feed={feed} />
      {screensMenu}
    </Screen>
  );
}
