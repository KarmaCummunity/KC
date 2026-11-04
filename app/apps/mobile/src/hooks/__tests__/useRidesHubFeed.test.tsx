// @vitest-environment jsdom
// #1626 — the rides hub feed state: the whole upcoming feed by default, the offers / requests
// filter over it, and a chosen route that swaps the feed for the corridor's ride offers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RideFeedItem, RideFeedSection, RidePlace } from '@kc/domain';

const { loadRidesFeed, findMatches } = vi.hoisted(() => ({ loadRidesFeed: vi.fn(), findMatches: vi.fn() }));

vi.mock('../../services/ridesFeedComposition', () => ({ loadRidesFeed, RIDES_FEED_QUERY_KEY: ['rides-feed'] }));
vi.mock('../../services/ridesKnowledgeComposition', () => ({ ridesKnowledgeRpcs: { findMatches } }));

import { useRidesHubFeed } from '../useRidesHubFeed';

const ride = (id: string, direction: 'give' | 'request'): RideFeedItem => ({
  listingId: id,
  direction,
  title: id,
  departsAt: '2099-01-01T06:00:00Z',
  originLabel: 'Lod',
  destLabel: 'Tel Aviv',
  meetingPoints: 0,
  seatsLeft: direction === 'give' ? 2 : null,
  passengers: direction === 'request' ? 1 : null,
  recurrence: null,
  seriesMore: 0,
});

const place = (id: string, lat: number): RidePlace => ({ kind: 'city', id, label: id, lat, lng: 34.9, cityId: id });

const ids = (sections: readonly RideFeedSection[]) => sections.flatMap((s) => s.items.map((item) => item.listingId));

function renderFeed(sections: RideFeedSection[]) {
  loadRidesFeed.mockResolvedValue(sections);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRidesHubFeed(), { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useRidesHubFeed', () => {
  it('opens on every upcoming offer and request, unrefined', async () => {
    const { result } = renderFeed([{ group: 'later', items: [ride('o1', 'give'), ride('r1', 'request')] }]);
    await waitFor(() => expect(ids(result.current.sections)).toEqual(['o1', 'r1']));
    expect(result.current.refined).toBe(false);
    expect(findMatches).not.toHaveBeenCalled();
  });

  it('narrows to one direction and clears back to the whole feed', async () => {
    const { result } = renderFeed([{ group: 'later', items: [ride('o1', 'give'), ride('r1', 'request')] }]);
    await waitFor(() => expect(ids(result.current.sections)).toHaveLength(2));
    act(() => result.current.setDirection('request'));
    expect(ids(result.current.sections)).toEqual(['r1']);
    expect(result.current.refined).toBe(true);
    act(() => result.current.clear());
    expect(ids(result.current.sections)).toEqual(['o1', 'r1']);
  });

  it('shows the corridor offers once both ends of a route are picked', async () => {
    findMatches.mockResolvedValue([
      { listing_id: 'm1', title: 'm1', seats_left: 1, departs_at: '2099-01-01T07:00:00Z', origin_label: 'Lod', dest_label: 'Haifa', distance_m: 10 },
    ]);
    const { result } = renderFeed([{ group: 'later', items: [ride('o1', 'give')] }]);
    await waitFor(() => expect(ids(result.current.sections)).toEqual(['o1']));

    act(() => result.current.setOrigin(place('lod', 31.95)));
    expect(result.current.routeActive).toBe(false);
    act(() => result.current.setDest(place('haifa', 32.79)));
    await waitFor(() => expect(ids(result.current.sections)).toEqual(['m1']));
    expect(result.current.routeActive).toBe(true);
    expect(findMatches).toHaveBeenCalledWith(
      expect.objectContaining({ originLat: 31.95, destLat: 32.79, radiusKm: 15 }),
    );

    act(() => result.current.clearRoute());
    expect(ids(result.current.sections)).toEqual(['o1']);
  });

  it('reports a feed that failed to load', async () => {
    loadRidesFeed.mockRejectedValue(new Error('offline'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRidesHubFeed(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.sections).toEqual([]);
  });
});
