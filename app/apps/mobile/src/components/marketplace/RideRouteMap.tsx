// The ride's route on a map: origin → meeting points → destination (D72; gap G46).
// A read-only map framed on the whole route; the explorer map stays the place to browse.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius } from '@kc/ui';
import { expandRegion, regionForPoints, type RideRoute } from '@kc/domain';
import { KcMap } from '../map/KcMap';

/** Map height: tall enough to read a route, short enough to keep the booking in view. */
const MAP_HEIGHT = 200;

const noop = () => undefined;

export function RideRouteMap({ route }: Readonly<{ route: RideRoute }>) {
  const { t } = useTranslation();
  const styles = useStyles();
  if (!route.origin || !route.dest) return null;

  const points = [route.origin, ...route.meetingPoints, route.dest];
  const region = regionForPoints(points);
  if (!region) return null;

  return (
    <View style={styles.box} testID="ride-route-map" accessibilityLabel={t('ridePlaces.mapA11y')}>
      <KcMap
        initialRegion={expandRegion(region)}
        clusters={[]}
        selectedId={null}
        route={{
          originLat: route.origin.lat,
          originLng: route.origin.lng,
          destLat: route.dest.lat,
          destLng: route.dest.lng,
        }}
        routeStops={route.meetingPoints}
        markRouteOrigin
        userLocation={null}
        focus={null}
        onRegionChange={noop}
        onPressCluster={noop}
        onPressMap={noop}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: {
    height: MAP_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
