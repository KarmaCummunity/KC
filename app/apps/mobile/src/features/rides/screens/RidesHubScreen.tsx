// Rides world hub: intro, request / offer, sub-screen links, the route search, then the rides
// feed — offers and requests by departure, grouped by day (docs/spec/05_giving_worlds.md §5.3
// "Feed", D75; FR-FEED-020 AC2).
import React from 'react';
import { Screen } from '../../../components/ui/Screen';
import { WorldHubHeader } from '../../../components/giving/WorldHubHeader';
import { worldSubScreens } from '../../../components/giving/worldSubScreens';
import { RideMatchSearch } from '../../../components/giving/RideMatchSearch';
import { RidesFeedList } from '../../../components/giving/RidesFeedList';

export function RidesHubScreen() {
  return (
    <Screen blobs="content">
      <RidesFeedList
        header={
          <WorldHubHeader
            worldSlug="rides"
            icon="car-outline"
            introKey="donations.rides.hubBody"
            linksCategory="transport"
            subScreens={worldSubScreens('/(tabs)/donations/rides/handoffs')}
            headerExtra={<RideMatchSearch />}
          />
        }
      />
    </Screen>
  );
}
