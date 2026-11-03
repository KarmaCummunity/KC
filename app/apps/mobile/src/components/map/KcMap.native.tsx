// Native map (Apple Maps on iOS, Google Maps on Android) with clustered pins + ride route line.
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { makeUseStyles, radius, shadow, spacing, typography, useTheme, Text } from '@kc/ui';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { isValidLatLng, mapWorldColor, sanitizeRegion, sanitizeRoute } from '@kc/domain';
import { createRegionChangeGate } from '../../lib/map/regionChangeGate';
import { clusterGlyph, routePath, type KcMapProps } from './KcMap.types';

export function KcMap(p: Readonly<KcMapProps>) {
  const { colors } = useTheme();
  const styles = useStyles();
  const ref = useRef<MapView>(null);
  const onRegionChange = useRef(p.onRegionChange);
  onRegionChange.current = p.onRegionChange;
  // Debounced + validated: bursts of region events must not re-cluster/remount markers mid-gesture.
  const gate = useMemo(() => createRegionChangeGate((r) => onRegionChange.current(r)), []);
  useEffect(() => () => gate.dispose(), [gate]);

  useEffect(() => {
    const r = sanitizeRegion(p.focus?.region);
    if (r) ref.current?.animateToRegion(r as Region, 350);
  }, [p.focus]);

  const initialRegion = sanitizeRegion(p.initialRegion) ?? undefined;
  const route = sanitizeRoute(p.route);

  // Children are a flat, keyed array with no null/false/fragment entries: under the new
  // architecture's legacy interop, AIRMap.insertReactSubview crashes on a nil child.
  const children: React.ReactElement[] = [];
  for (const c of p.clusters) {
    if (!isValidLatLng(c.lat, c.lng)) continue;
    const multi = c.pins.length > 1;
    const selected = !multi && c.pins[0]?.listingId === p.selectedId;
    const color = mapWorldColor(c.worldSlug);
    children.push(
      <Marker
        key={`m:${c.key}`}
        coordinate={{ latitude: c.lat, longitude: c.lng }}
        onPress={() => p.onPressCluster(c)}
        tracksViewChanges={false}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View
          style={[
            multi ? styles.cluster : styles.pin,
            { backgroundColor: multi ? color : colors.surface, borderColor: color },
            selected ? styles.selected : null,
          ]}
        >
          <Text style={multi ? styles.clusterText : styles.pinText}>{clusterGlyph(c)}</Text>
        </View>
      </Marker>,
    );
  }
  if (route) {
    const path = routePath(route, p.routeStops);
    children.push(
      <Polyline
        key="route:line"
        coordinates={path.map((pt) => ({ latitude: pt.lat, longitude: pt.lng }))}
        strokeColor={mapWorldColor('rides')}
        strokeWidth={4}
        lineDashPattern={[8, 6]}
      />,
      <Marker key="route:dest" coordinate={{ latitude: route.destLat, longitude: route.destLng }} pinColor={colors.info} />,
    );
    // Meeting points sit between the two ends of the path.
    path.slice(1, -1).forEach((pt, i) => {
      children.push(
        <Marker key={`route:stop:${i}`} coordinate={{ latitude: pt.lat, longitude: pt.lng }} pinColor={mapWorldColor('rides')} />,
      );
    });
    if (p.markRouteOrigin) {
      children.push(
        <Marker key="route:origin" coordinate={{ latitude: route.originLat, longitude: route.originLng }} pinColor={colors.success} />,
      );
    }
  }

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion as Region | undefined}
      showsUserLocation={p.userLocation != null}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      onRegionChangeComplete={(r) => gate.push(r)}
      onPress={(e) => {
        if (e.nativeEvent.action !== 'marker-press') p.onPressMap();
      }}
    >
      {children}
    </MapView>
  );
}

// Pins are circles in the world colour; a cluster is filled and shows its count.
const useStyles = makeUseStyles(({ colors }) => ({
  pin: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    ...shadow.glow,
    shadowColor: colors.shadow,
  },
  cluster: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    ...shadow.glow,
    shadowColor: colors.shadow,
  },
  selected: { transform: [{ scale: 1.25 }], borderWidth: 3 },
  pinText: { ...typography.h3 },
  clusterText: { ...typography.button, color: colors.textInverse },
}));
