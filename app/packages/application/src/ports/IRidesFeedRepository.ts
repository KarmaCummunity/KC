import type { RideFeedItem } from '@kc/domain';

/** The rides feed (docs/spec/05_giving_worlds.md §5.3 "Feed", D75). */
export interface IRidesFeedRepository {
  /** Open ride offers and requests not yet departed, soonest first. */
  list(limit: number): Promise<RideFeedItem[]>;
}
