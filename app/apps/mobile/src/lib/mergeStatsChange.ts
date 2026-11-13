// FR-KARMA-009 — applies the counters the server pushes on `user:<id>:stats` to the cached own
// profile, so the karma badge and the profile counters change without a refetch.
import type { StatsChange } from '@kc/application';
import type { User } from '@kc/domain';

/** The cached profile with the pushed counters; the same object when nothing differs. */
export function mergeStatsChange(prev: User | null | undefined, change: StatsChange): User | null | undefined {
  if (!prev) return prev;
  const next: User = {
    ...prev,
    karmaPoints: change.karmaPoints,
    followersCount: change.followersCount,
    followingCount: change.followingCount,
    itemsGivenCount: change.itemsGivenCount,
    itemsReceivedCount: change.itemsReceivedCount,
    activePostsCountInternal: change.openPostsCount,
  };
  const same =
    prev.karmaPoints === next.karmaPoints &&
    prev.followersCount === next.followersCount &&
    prev.followingCount === next.followingCount &&
    prev.itemsGivenCount === next.itemsGivenCount &&
    prev.itemsReceivedCount === next.itemsReceivedCount &&
    prev.activePostsCountInternal === next.activePostsCountInternal;
  return same ? prev : next;
}
