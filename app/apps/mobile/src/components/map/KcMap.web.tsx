// Web map: Leaflet + OpenStreetMap tiles (react-native-maps has no web support).
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type * as LeafletNS from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { mapWorldColor, type MapRegion } from '@kc/domain';
import { useTheme } from '@kc/ui';
import { clusterGlyph, routePath, type KcMapProps } from './KcMap.types';

type L = typeof LeafletNS;

function regionFromMap(m: LeafletNS.Map): MapRegion {
  const b = m.getBounds();
  const c = b.getCenter();
  return {
    latitude: c.lat,
    longitude: c.lng,
    latitudeDelta: b.getNorth() - b.getSouth(),
    longitudeDelta: b.getEast() - b.getWest(),
  };
}

function zoomForDelta(delta: number): number {
  return Math.max(3, Math.min(18, Math.round(Math.log2(360 / Math.max(delta, 1e-4)))));
}

export function KcMap(p: Readonly<KcMapProps>) {
  const { colors } = useTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const lib = useRef<L | null>(null);
  const map = useRef<LeafletNS.Map | null>(null);
  const layer = useRef<LeafletNS.LayerGroup | null>(null);
  const cb = useRef(p);
  cb.current = p;
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((mod) => {
      const Lf = ((mod as unknown as { default?: L }).default ?? mod) as L;
      if (disposed || !host.current) return;
      lib.current = Lf;
      const m = Lf.map(host.current, { zoomControl: true, attributionControl: true }).setView(
        [p.initialRegion.latitude, p.initialRegion.longitude],
        zoomForDelta(p.initialRegion.latitudeDelta),
      );
      Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(m);
      layer.current = Lf.layerGroup().addTo(m);
      m.on('moveend', () => cb.current.onRegionChange(regionFromMap(m)));
      m.on('click', () => cb.current.onPressMap());
      map.current = m;
      setReady(true);
      cb.current.onRegionChange(regionFromMap(m));
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const Lf = lib.current;
    const g = layer.current;
    if (!ready || !Lf || !g) return;
    g.clearLayers();
    if (p.route) {
      const path = routePath(p.route, p.routeStops);
      Lf.polyline(
        path.map((pt) => [pt.lat, pt.lng] as [number, number]),
        { color: mapWorldColor('rides'), weight: 4, dashArray: '8 6' },
      ).addTo(g);
      Lf.circleMarker([p.route.destLat, p.route.destLng], { radius: 7, color: colors.info }).addTo(g);
      // Meeting points sit between the two ends of the path.
      for (const pt of path.slice(1, -1)) {
        Lf.circleMarker([pt.lat, pt.lng], { radius: 5, color: mapWorldColor('rides'), fillOpacity: 1 }).addTo(g);
      }
      if (p.markRouteOrigin) {
        Lf.circleMarker([p.route.originLat, p.route.originLng], { radius: 7, color: colors.success }).addTo(g);
      }
    }
    if (p.userLocation) {
      Lf.circleMarker([p.userLocation.lat, p.userLocation.lng], {
        radius: 8, color: colors.surface, weight: 3, fillColor: colors.info, fillOpacity: 1,
      }).addTo(g);
    }
    for (const c of p.clusters) {
      const multi = c.pins.length > 1;
      const color = mapWorldColor(c.worldSlug);
      const selected = !multi && c.pins[0]?.listingId === p.selectedId;
      const size = multi ? 40 : selected ? 44 : 36;
      const html =
        `<div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;` +
        `justify-content:center;border:${selected || multi ? 3 : 2}px solid ${color};` +
        `background:${multi ? color : colors.surface};color:${colors.textInverse};font-weight:700;font-size:${multi ? 15 : 18}px;` +
        `box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer">${clusterGlyph(c)}</div>`;
      const icon = Lf.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      Lf.marker([c.lat, c.lng], { icon, keyboard: true, title: c.pins[0]?.title ?? '' })
        .on('click', (e) => {
          Lf.DomEvent.stopPropagation(e);
          cb.current.onPressCluster(c);
        })
        .addTo(g);
    }
  }, [ready, colors, p.clusters, p.route, p.routeStops, p.markRouteOrigin, p.userLocation, p.selectedId]);

  useEffect(() => {
    if (!p.focus || !map.current) return;
    map.current.flyTo([p.focus.region.latitude, p.focus.region.longitude], zoomForDelta(p.focus.region.latitudeDelta), {
      duration: 0.4,
    });
  }, [p.focus]);

  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
      {React.createElement('div', { ref: host, style: { width: '100%', height: '100%', direction: 'ltr' } })}
    </View>
  );
}
