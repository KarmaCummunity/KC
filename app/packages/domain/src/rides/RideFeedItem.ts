// The rides feed (docs/spec/05_giving_worlds.md §5.3 "Feed", D75; gap G49): offers and requests
// together, soonest departure first, grouped today / tomorrow / later; departed rides are hidden.
import type { RideSeriesMarker } from './RideSeries';

export interface RideFeedItem {
  readonly listingId: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  readonly departsAt: string;
  readonly originLabel: string | null;
  readonly destLabel: string | null;
  readonly meetingPoints: number;
  /** Offers: seats still free. Null for requests. */
  readonly seatsLeft: number | null;
  /** Requests: passengers asking. Null for offers. */
  readonly passengers: number | null;
  /** The series of a recurring ride's occurrence (FR-RIDE-046); null on a single ride. */
  readonly recurrence: RideSeriesMarker | null;
  /** Later dates of the series folded into this row (the feed folds a series beyond tomorrow). */
  readonly seriesMore: number;
}

export const RIDE_FEED_GROUPS = ['today', 'tomorrow', 'later'] as const;
export type RideFeedGroup = (typeof RIDE_FEED_GROUPS)[number];

export interface RideFeedSection {
  readonly group: RideFeedGroup;
  readonly items: readonly RideFeedItem[];
}

/** Start of the local day `days` after `now`. */
function localDayStart(now: Date, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * Groups rides by local departure day. Rides that already left are dropped (the server hides
 * them too; this covers a feed loaded a while ago). Empty groups are omitted; order is kept.
 */
export function groupRidesByDay(items: readonly RideFeedItem[], now: Date): RideFeedSection[] {
  const tomorrow = localDayStart(now, 1);
  const dayAfter = localDayStart(now, 2);
  const byGroup: Record<RideFeedGroup, RideFeedItem[]> = { today: [], tomorrow: [], later: [] };
  for (const item of items) {
    const at = Date.parse(item.departsAt);
    if (Number.isNaN(at) || at <= now.getTime()) continue;
    const group: RideFeedGroup = at < tomorrow ? 'today' : at < dayAfter ? 'tomorrow' : 'later';
    byGroup[group].push(item);
  }
  return RIDE_FEED_GROUPS.filter((g) => byGroup[g].length > 0).map((group) => ({ group, items: byGroup[group] }));
}
