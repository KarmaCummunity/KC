import type { RideFeedItem, RidePlace } from '@kc/domain';

/** A route to run the feed along: ride offers near both ends (D71). */
export interface RideFeedRoute {
  readonly origin: RidePlace;
  readonly dest: RidePlace;
  readonly radiusKm: number;
}

/** The rides feed (docs/spec/05_giving_worlds.md §5.3 "Feed", D75). */
export interface IRidesFeedRepository {
  /** Open ride offers and requests not yet departed, soonest first; with a route, the offers along it. */
  list(limit: number, route?: RideFeedRoute): Promise<RideFeedItem[]>;
}
