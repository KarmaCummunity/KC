import type { SupabaseClient } from '@supabase/supabase-js';
import { rideWeekdaysFromMask, type RideFeedItem, type RideSeriesMarker } from '@kc/domain';
import type { IRidesFeedRepository, RideFeedRoute } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { refOfPlace, toPlaceDocument } from './ridePlaces';
import { BackendRuleError } from '@kc/domain';

type Client = SupabaseClient<Database>;
type FeedRow = Database['public']['Functions']['rides_feed']['Returns'][number];

/** The rides feed over `rides_feed` (docs/spec/05_giving_worlds.md §5.3, D75): the first page, soonest first. */
export class SupabaseRidesFeedRepository implements IRidesFeedRepository {
  constructor(private readonly client: Client) {}

  async list(limit: number, route?: RideFeedRoute): Promise<RideFeedItem[]> {
    const rows = unwrapCall(
      'rpc:rides_feed',
      await this.client.rpc('rides_feed', { p_limit: limit, p_filters: routeFilters(route) }),
    );
    return (rows ?? []).flatMap((row) => {
      const item = mapFeedRow(row);
      return item ? [item] : [];
    });
  }
}

/** `p_filters` of a route search: the offers whose ends lie within the radius of the two places. */
function routeFilters(route: RideFeedRoute | undefined): Json {
  if (!route) return {};
  const origin = refOfPlace(route.origin);
  const dest = refOfPlace(route.dest);
  if (!origin || !dest) throw new BackendRuleError('ride_place_invalid', 'rpc:rides_feed');
  return { direction: 'offer', origin: { ...toPlaceDocument(origin) }, dest: { ...toPlaceDocument(dest) }, radius_km: route.radiusKm };
}

const meetingPointCount = (points: Json): number => (Array.isArray(points) ? points.length : 0);

/** The series marker of an occurrence row; null on a single ride or a series no longer running. */
function seriesMarkerOf(row: FeedRow): RideSeriesMarker | null {
  if (!row.series_id || !row.series_on || row.series_weekdays === null || !row.series_depart_time) return null;
  const weekdays = rideWeekdaysFromMask(row.series_weekdays);
  if (weekdays.length === 0) return null;
  // `series_depart_time` arrives as `HH:MM:SS`, Israel time.
  return { id: row.series_id, on: row.series_on, weekdays, time: row.series_depart_time.slice(0, 5) };
}

/**
 * Maps one feed row; a row of an unknown direction is dropped. An offer states its free seats, a
 * request its passengers. An occurrence of a recurring ride carries its series marker, and
 * `seriesMore` counts the later dates folded into it.
 */
export function mapFeedRow(row: FeedRow): RideFeedItem | null {
  if (row.direction !== 'offer' && row.direction !== 'request') return null;
  const offer = row.direction === 'offer';
  return {
    listingId: row.post_id,
    direction: offer ? 'give' : 'request',
    title: row.title,
    departsAt: row.departs_at,
    originLabel: row.origin_name,
    destLabel: row.dest_name,
    meetingPoints: meetingPointCount(row.meeting_points),
    seatsLeft: offer ? row.seats_left : null,
    passengers: offer ? null : row.seats,
    recurrence: seriesMarkerOf(row),
    seriesMore: row.series_more,
  };
}
