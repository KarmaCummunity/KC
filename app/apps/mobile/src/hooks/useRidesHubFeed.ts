// State of the rides hub feed (#1626; docs/spec/05_giving_worlds.md §5.3 "Feed", D75, D71).
// The screen opens on every upcoming offer and request (`list_rides_feed`, soonest first,
// departed rides hidden), grouped today / tomorrow / later. Two filters narrow it:
//  - offers / requests, like every other world feed;
//  - a route: once both ends are picked, the feed shows the ride offers along that corridor
//    (`find_ride_listing_matches`, 15 km) instead of the whole feed.
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { groupRidesByDay, type RideFeedSection, type RidePlace } from '@kc/domain';
import { loadRidesFeed, RIDES_FEED_QUERY_KEY } from '../services/ridesFeedComposition';
import { ridesKnowledgeRpcs } from '../services/ridesKnowledgeComposition';
import { filterRideSections, rideRouteMatchFeedItem } from '../lib/rides/ridesHubFeed';
import type { WorldFeedDirection } from '../lib/worldFeed';

/** The feed refreshes every minute so departed rides drop off while the hub stays open. */
const REFRESH_MS = 60_000;
/** Corridor width around the chosen route, in km (the route search's long-standing value). */
const ROUTE_RADIUS_KM = 15;

export function useRidesHubFeed() {
  const [direction, setDirection] = useState<WorldFeedDirection>('all');
  const [origin, setOrigin] = useState<RidePlace | null>(null);
  const [dest, setDest] = useState<RidePlace | null>(null);
  const routeActive = origin !== null && dest !== null;

  const feed = useQuery({ queryKey: RIDES_FEED_QUERY_KEY, queryFn: loadRidesFeed, refetchInterval: REFRESH_MS });
  const matches = useQuery({
    queryKey: ['ride-matches', origin?.kind, origin?.id, dest?.kind, dest?.id],
    enabled: routeActive,
    queryFn: () =>
      ridesKnowledgeRpcs.findMatches({
        originLat: origin!.lat,
        originLng: origin!.lng,
        destLat: dest!.lat,
        destLng: dest!.lng,
        radiusKm: ROUTE_RADIUS_KM,
      }),
    staleTime: 30_000,
  });
  const active = routeActive ? matches : feed;

  const sections = useMemo<RideFeedSection[]>(() => {
    const base = routeActive
      ? groupRidesByDay((matches.data ?? []).map(rideRouteMatchFeedItem), new Date())
      : (feed.data ?? []);
    return filterRideSections(base, direction);
  }, [routeActive, matches.data, feed.data, direction]);

  const clearRoute = useCallback(() => {
    setOrigin(null);
    setDest(null);
  }, []);

  /** Back to the whole feed: every direction, no route. */
  const clear = useCallback(() => {
    setDirection('all');
    clearRoute();
  }, [clearRoute]);

  return {
    sections,
    direction,
    setDirection,
    origin,
    setOrigin,
    dest,
    setDest,
    routeActive,
    clearRoute,
    /** Anything narrowing the feed beyond "every upcoming ride". */
    refined: routeActive || direction !== 'all',
    clear,
    isLoading: active.isLoading,
    isError: active.isError,
    isRefreshing: active.isRefetching,
    refresh: () => void active.refetch(),
  };
}

export type RidesHubFeedState = ReturnType<typeof useRidesHubFeed>;
