import type { SupabaseClient } from '@supabase/supabase-js';
import { readRideSeriesMarker, type RideFeedItem } from '@kc/domain';
import type { IRidesFeedRepository } from '@kc/application';
import type { Database } from '../database.legacy.types';

type Client = SupabaseClient<Database>;
type FeedRow = Database['public']['Functions']['list_rides_feed']['Returns'][number];

/** The rides feed over `list_rides_feed` (0515; docs/spec/05_giving_worlds.md §5.3, D75). */
export class SupabaseRidesFeedRepository implements IRidesFeedRepository {
  constructor(private readonly client: Client) {}

  async list(limit: number): Promise<RideFeedItem[]> {
    const { data, error } = await this.client.rpc('list_rides_feed', { p_limit: limit });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) => {
      const item = mapFeedRow(row);
      return item ? [item] : [];
    });
  }
}

/** Maps one feed row; a row of an unknown direction is dropped. */
export function mapFeedRow(row: FeedRow): RideFeedItem | null {
  if (row.direction !== 'give' && row.direction !== 'request') return null;
  return {
    listingId: row.listing_id,
    direction: row.direction,
    title: row.title,
    departsAt: row.departs_at,
    originLabel: row.origin_label ?? null,
    destLabel: row.dest_label ?? null,
    meetingPoints: row.meeting_points ?? 0,
    seatsLeft: row.seats_left ?? null,
    passengers: row.passengers ?? null,
    // The series marker rides along as the occurrence's own details would carry it.
    recurrence: readRideSeriesMarker({ ride_series: row.recurrence }),
    seriesMore: row.series_more ?? 0,
  };
}
