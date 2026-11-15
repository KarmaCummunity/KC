// The rides feed, grouped today / tomorrow / later in local time (D75; gap G49).
import { groupRidesByDay, type RideFeedSection } from '@kc/domain';
import type { IRidesFeedRepository, RideFeedRoute } from '../ports/IRidesFeedRepository';

/** Enough for a few days of a busy route; the server caps at 200. */
const FEED_LIMIT = 100;

export class ListRidesFeedUseCase {
  constructor(private readonly repo: IRidesFeedRepository) {}
  async execute(now: Date = new Date(), route?: RideFeedRoute): Promise<RideFeedSection[]> {
    return groupRidesByDay(await this.repo.list(FEED_LIMIT, route), now);
  }
}
