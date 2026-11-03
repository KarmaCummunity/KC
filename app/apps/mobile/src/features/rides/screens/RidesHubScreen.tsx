// Rides world hub: intro, request / offer, sub-screen links, the route search, then the rides
// feed — offers and requests by departure, grouped by day (docs/spec/05_giving_worlds.md §5.3
// "Feed", D75; FR-FEED-020 AC2).
import React from 'react';
import { Screen } from '../../../components/ui/Screen';
import { WorldHubHeader } from '../../../components/giving/WorldHubHeader';
import { worldSubScreens } from '../../../components/giving/worldSubScreens';
import { WorldLinksSection } from '../../../components/giving/WorldLinksSection';
import { RideMatchSearch } from '../../../components/giving/RideMatchSearch';
import { RidesFeedList } from '../../../components/giving/RidesFeedList';

export function RidesHubScreen() {
  return (
    <Screen blobs="content">
      <RidesFeedList
        header={
          <WorldHubHeader
            icon="car-outline"
            introKey="donations.rides.hubBody"
            subScreens={worldSubScreens('/(tabs)/donations/rides/handoffs', [
              { labelKey: 'rideSeries.mine', path: '/(tabs)/donations/rides/series', testID: 'world-hub-ride-series' },
            ])}
            headerExtra={<RideMatchSearch />}
          />
        }
        // The NGO links come after the feed so the rides are the first thing on screen.
        footer={<WorldLinksSection categorySlug="transport" />}
      />
    </Screen>
  );
}
