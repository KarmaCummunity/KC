import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideFeedItem } from '@kc/domain';
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

/**
 * Maps one feed row; a row of an unknown direction is dropped. An offer states its free seats, a
 * request its passengers. The feed does not say which weekdays a recurring ride runs, so the
 * row carries no series marker; `seriesMore` still counts the later dates folded into it.
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
    recurrence: null,
    seriesMore: row.series_more,
  };
}
