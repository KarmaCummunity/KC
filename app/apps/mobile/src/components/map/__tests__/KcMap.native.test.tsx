// @vitest-environment jsdom
// Regression (#1214 follow-up): iOS crashed in AIRMap.insertReactSubview with a nil child.
// MapView must only receive a flat array of valid, keyed overlays — no null/false/fragments,
// no NaN coordinates — and region bursts must be debounced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { LOD_REGION, type MapPinCluster, type MarketplaceMapPin } from '@kc/domain';

const captured: { children: unknown; onRegionChangeComplete?: (r: unknown) => void } = { children: null };
vi.mock('react-native-maps', () => {
  const MapView = React.forwardRef((props: { children?: React.ReactNode; onRegionChangeComplete?: (r: unknown) => void }, _ref) => {
    captured.children = props.children;
    captured.onRegionChangeComplete = props.onRegionChangeComplete;
    return <div>{props.children}</div>;
  });
  const Marker = (p: { children?: React.ReactNode }) => <div data-kind="marker">{p.children}</div>;
  const Polyline = () => <div data-kind="polyline" />;
  return { __esModule: true, default: MapView, Marker, Polyline };
});

import { KcMap } from '../KcMap.native';

const pin = (id: string, lat: number, lng: number): MarketplaceMapPin => ({
  listingId: id, worldSlug: 'rides', kindSlug: 'k', direction: 'give', title: id, summary: null, lat, lng, route: null, ride: null,
});
const cluster = (key: string, lat: number, lng: number): MapPinCluster => ({ key, lat, lng, pins: [pin(key, lat, lng)], worldSlug: 'rides' });

function renderMap(over: Partial<React.ComponentProps<typeof KcMap>> = {}) {
  const onRegionChange = vi.fn();
  render(
    <KcMap
      initialRegion={LOD_REGION}
      clusters={[]}
      selectedId={null}
      route={null}
      userLocation={null}
      focus={null}
      onRegionChange={onRegionChange}
      onPressCluster={vi.fn()}
      onPressMap={vi.fn()}
      {...over}
    />,
  );
  return onRegionChange;
}

const childList = () => captured.children as React.ReactElement[];

describe('KcMap.native', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes a flat array with no null/false/fragment children when there is no route', () => {
    renderMap({ clusters: [cluster('a', 31.95, 34.89)] });
    expect(Array.isArray(captured.children)).toBe(true);
    for (const c of childList()) {
      expect(React.isValidElement(c)).toBe(true);
      expect(c.type).not.toBe(React.Fragment);
      expect(c.key).toBeTruthy();
    }
  });

  it('drops clusters with NaN/out-of-range coordinates', () => {
    renderMap({ clusters: [cluster('ok', 31.95, 34.89), cluster('nan', NaN, 34.89), cluster('far', 95, 10)] });
    expect(childList().map((c) => c.key)).toEqual(['m:ok']);
  });

  it('renders a valid route as two keyed siblings and ignores a broken one', () => {
    renderMap({ route: { originLat: 31.9, originLng: 34.8, destLat: 32, destLng: 34.9 } });
    expect(childList().map((c) => c.key)).toEqual(['route:line', 'route:dest']);
    renderMap({ route: { originLat: 31.9, originLng: 34.8, destLat: NaN, destLng: 34.9 } });
    expect(childList()).toEqual([]);
  });

  it('debounces rapid region changes and ignores invalid ones', () => {
    const onRegionChange = renderMap();
    act(() => {
      for (let i = 0; i < 20; i++) captured.onRegionChangeComplete?.({ ...LOD_REGION, latitude: LOD_REGION.latitude + i * 0.01 });
      captured.onRegionChangeComplete?.({ ...LOD_REGION, latitude: NaN });
    });
    expect(onRegionChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onRegionChange).toHaveBeenCalledTimes(1);
  });
});
