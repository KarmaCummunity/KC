/**
 * ListMyActivityTimelineUseCase — FR-STATS-003 (personal activity feed).
 */

import type { PersonalActivityItem } from '@kc/domain';
import type { IStatsRepository } from '../ports/IStatsRepository';

/** FR-STATS-003 AC1: the timeline shows up to the 30 most recent entries. */
const MAX_TIMELINE_ENTRIES = 30;

export class ListMyActivityTimelineUseCase {
  constructor(private readonly stats: IStatsRepository) {}

  /** Lists the caller's most recent activity; `limit` is clamped to 1..30 whole entries. */
  async execute(limit = MAX_TIMELINE_ENTRIES): Promise<PersonalActivityItem[]> {
    const safe = Math.min(MAX_TIMELINE_ENTRIES, Math.max(1, Math.trunc(limit)));
    return this.stats.listMyActivityTimeline(safe);
  }
}
