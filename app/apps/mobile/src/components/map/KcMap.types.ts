import { isValidLatLng, type MapPinCluster, type MapRegion, type MarketplaceMapPin } from '@kc/domain';

export interface KcMapFocus {
  readonly region: MapRegion;
  /** Bump to re-apply the same region. */
  readonly nonce: number;
}

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface KcMapProps {
  readonly initialRegion: MapRegion;
  readonly clusters: readonly MapPinCluster[];
  readonly selectedId: string | null;
  readonly route: MarketplaceMapPin['route'];
  /** Ride meeting points, drawn in order between the route's origin and destination (D72). */
  readonly routeStops?: readonly LatLng[];
  /** Mark the route's origin too (a ride detail map has no ride pin standing on it). */
  readonly markRouteOrigin?: boolean;
  readonly userLocation: { lat: number; lng: number } | null;
  readonly focus: KcMapFocus | null;
  readonly onRegionChange: (r: MapRegion) => void;
  readonly onPressCluster: (c: MapPinCluster) => void;
  readonly onPressMap: () => void;
}

const WORLD_GLYPH: Record<string, string> = {
  items: '🎁',
  food: '🍲',
  rides: '🚗',
  knowledge: '📚',
  time: '⏳',
  money: '💰',
};

export function clusterGlyph(c: MapPinCluster): string {
  if (c.pins.length > 1) return String(c.pins.length > 99 ? '99+' : c.pins.length);
  return WORLD_GLYPH[c.worldSlug ?? ''] ?? '📍';
}

/** The route's points in driving order — origin, valid meeting points, destination. */
export function routePath(route: MarketplaceMapPin['route'], stops: readonly LatLng[] = []): LatLng[] {
  if (!route) return [];
  return [
    { lat: route.originLat, lng: route.originLng },
    ...stops.filter((s) => isValidLatLng(s.lat, s.lng)),
    { lat: route.destLat, lng: route.destLng },
  ];
}
