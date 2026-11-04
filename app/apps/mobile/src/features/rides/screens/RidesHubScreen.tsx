// Rides world hub (#1626; docs/spec/05_giving_worlds.md §5.3 "Feed", D75): the screen opens on
// the rides feed — every upcoming offer and request, grouped by day, on the shared listing card.
// Above it: intro, the world's own screens, then the filters (route, offers / requests). The
// community links ("nonprofits and links") sit collapsed under the feed.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { Screen } from '../../../components/ui/Screen';
import { WorldHubHeader } from '../../../components/giving/WorldHubHeader';
import { worldSubScreens } from '../../../components/giving/worldSubScreens';
import { WorldLinksSection } from '../../../components/giving/WorldLinksSection';
import { WorldFeedDirectionChips } from '../../../components/giving/WorldFeedControls';
import { RideRouteFilter } from '../../../components/giving/RideRouteFilter';
import { RidesFeedList } from '../../../components/giving/RidesFeedList';
import { useRidesHubFeed } from '../../../hooks/useRidesHubFeed';

const useStyles = makeUseStyles(() => ({
  chips: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
}));

export function RidesHubScreen() {
  const styles = useStyles();
  const feed = useRidesHubFeed();

  return (
    <Screen blobs="content">
      <RidesFeedList
        feed={feed}
        header={
          <WorldHubHeader
            icon="car-outline"
            introKey="donations.rides.hubBody"
            subScreens={worldSubScreens('/(tabs)/donations/rides/handoffs', [
              { labelKey: 'rideSeries.mine', path: '/(tabs)/donations/rides/series', testID: 'world-hub-ride-series' },
            ])}
            headerExtra={
              <>
                <RideRouteFilter filter={feed} />
                <View style={styles.chips}>
                  <WorldFeedDirectionChips value={feed.direction} onChange={feed.setDirection} />
                </View>
              </>
            }
          />
        }
        footer={<WorldLinksSection categorySlug="transport" collapsible />}
      />
    </Screen>
  );
}
