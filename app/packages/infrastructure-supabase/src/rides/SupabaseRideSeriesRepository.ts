import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BackendRuleError,
  RIDE_SERIES_STATUSES,
  rideWeekdaysFromMask,
  rideWeekdaysToMask,
  type CreateRideSeriesInput,
  type CreatedRideSeries,
  type RidePlace,
  type RideSeries,
  type RideSeriesOccurrence,
  type RideSeriesSchedule,
  type RideSeriesStatus,
} from '@kc/domain';
import type { IRideSeriesRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from '../marketplace/rpcRow';
import { loadKindCatalog, postDirectionOf } from '../marketplace/kindCatalog';
import { freeDetails, rideCityId, rideDetailColumns, rideDetailsFromRow } from '../marketplace/worldDetails';
import { loadSeatCounts } from '../marketplace/postSeatCounts';
import { meetingPointRefs, placeRefKey, resolvePlaces, type PlaceRef } from './ridePlaces';

type Client = SupabaseClient<Database>;
type SeriesRow = Database['public']['Tables']['ride_series']['Row'];

const isObject = (value: Json): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ref = (row: Record<string, Json | undefined>, prefix: 'origin' | 'dest'): PlaceRef => ({
  cityId: typeof row[`${prefix}_city_id`] === 'string' ? (row[`${prefix}_city_id`] as string) : null,
  streetId: typeof row[`${prefix}_street_id`] === 'number' ? (row[`${prefix}_street_id`] as number) : null,
  junctionId: typeof row[`${prefix}_junction_id`] === 'number' ? (row[`${prefix}_junction_id`] as number) : null,
});

/**
 * Recurring rides over `ride_series` (readable by its owner alone) and its RPCs, which own the
 * occurrences: `create_ride_series`, `set_ride_series_status`, `update_ride_series`. Occurrences are
 * ordinary ride posts, so their list is a read of `post_ride_details` by `series_id`.
 */
export class SupabaseRideSeriesRepository implements IRideSeriesRepository {
  constructor(private readonly client: Client) {}

  async listMine(): Promise<RideSeries[]> {
    const rows =
      unwrapCall(
        'table:ride_series',
        await this.client.from('ride_series').select('*').neq('status', 'cancelled').order('created_at', { ascending: true }),
      ) ?? [];
    const refs = rows.flatMap((row) => (isObject(row.ride_template) ? [ref(row.ride_template, 'origin'), ref(row.ride_template, 'dest')] : []));
    const places = await resolvePlaces(this.client, refs);
    return rows.flatMap((row) => {
      const series = mapRideSeriesRow(row, places);
      return series ? [series] : [];
    });
  }

  /** Publishes the series and its first occurrences; resolves to the series and the soonest ride. */
  async create(input: CreateRideSeriesInput): Promise<CreatedRideSeries> {
    const kind = (await loadKindCatalog(this.client)).byId.get(input.kindId);
    const direction = postDirectionOf(input.direction);
    const cityId = rideCityId(input.details);
    // The template has no times of its own: every occurrence takes them from the schedule.
    const columns = rideDetailColumns({ ...input.details, departs_at: 'template' }, direction);
    if (!kind || !cityId || !columns) throw new BackendRuleError('ride_place_invalid', 'rpc:create_ride_series');
    const { departs_at: _departs, arrives_at: _arrives, ...ride } = columns;
    const seriesId = requireRpcRow(unwrapCall(
      'rpc:create_ride_series',
      await this.client.rpc('create_ride_series', {
        p_post: {
          world_slug: kind.world_slug, kind_id: input.kindId, direction, title: input.title,
          description: input.summary, city_id: cityId, details: freeDetails(input.details, 'rides'),
        },
        p_ride: ride as Json,
        p_depart_time: input.schedule.time,
        p_weekdays: rideWeekdaysToMask(input.schedule.weekdays),
        p_duration_minutes: input.durationMinutes ?? undefined,
        p_ends_on: input.schedule.endsOn ?? undefined,
      }),
    ), 'create_ride_series');
    return { seriesId, firstListingId: await this.soonestOccurrence(seriesId) };
  }

  async setStatus(seriesId: string, status: RideSeriesStatus): Promise<void> {
    unwrapCall('rpc:set_ride_series_status', await this.client.rpc('set_ride_series_status', { p_series_id: seriesId, p_status: status }));
  }

  /** The upcoming open occurrences of a series, soonest first; an offer shows its free seats (`post_seat_counts`). */
  async listOccurrences(seriesId: string): Promise<RideSeriesOccurrence[]> {
    const rows =
      unwrapCall(
        'table:post_ride_details',
        await this.client
          .from('post_ride_details')
          .select('post_id, departs_at, seats, posts(status, direction)')
          .eq('series_id', seriesId)
          .gt('departs_at', new Date().toISOString())
          .order('departs_at', { ascending: true }),
      ) ?? [];
    const open = rows.flatMap((row) => {
      const post = Array.isArray(row.posts) ? row.posts[0] : row.posts;
      return post?.status === 'open' ? [{ row, offer: post.direction === 'offer' }] : [];
    });
    const seats = await loadSeatCounts(this.client, open.filter((o) => o.offer).map((o) => o.row.post_id));
    return open.map(({ row, offer }) => ({
      listingId: row.post_id,
      departsAt: row.departs_at,
      // A count the caller cannot read (the occurrence just left the air) falls back to the seats offered.
      seatsLeft: offer ? seats.get(row.post_id)?.left ?? row.seats : null,
      passengers: offer ? null : row.seats,
    }));
  }

  async updateSchedule(seriesId: string, schedule: RideSeriesSchedule, durationMinutes: number | null): Promise<void> {
    unwrapCall(
      'rpc:update_ride_series',
      await this.client.rpc('update_ride_series', {
        p_series_id: seriesId,
        p_depart_time: schedule.time,
        p_weekdays: rideWeekdaysToMask(schedule.weekdays),
        p_duration_minutes: durationMinutes ?? undefined,
        p_ends_on: schedule.endsOn ?? undefined,
      }),
    );
  }

  /** The soonest occurrence of a series; the RPC publishes the first one before it returns. */
  private async soonestOccurrence(seriesId: string): Promise<string> {
    const row = unwrapCall(
      'table:post_ride_details',
      await this.client.from('post_ride_details').select('post_id').eq('series_id', seriesId).order('departs_at', { ascending: true }).limit(1).maybeSingle(),
    );
    if (!row) throw new BackendRuleError('ride_series_no_occurrence', 'rpc:create_ride_series');
    return row.post_id;
  }
}

function isStatus(value: string): value is RideSeriesStatus {
  return (RIDE_SERIES_STATUSES as readonly string[]).includes(value);
}

/** Maps one row; a row of an unknown status or without a readable template is dropped. `depart_time` arrives as `HH:MM:SS`. */
export function mapRideSeriesRow(row: SeriesRow, places: ReadonlyMap<string, RidePlace>): RideSeries | null {
  if (!isStatus(row.status) || !isObject(row.post_template) || !isObject(row.ride_template)) return null;
  const post = row.post_template;
  const ride = row.ride_template;
  const direction = post['direction'] === 'request' ? 'request' : 'offer';
  const stops = meetingPointRefs(ride['meeting_points'] ?? []).flatMap((r) => {
    const place = places.get(placeRefKey(r));
    return place ? [place] : [];
  });
  const details = rideDetailsFromRow(
    {
      departs_at: '', arrives_at: null, seats: typeof ride['seats'] === 'number' ? ride['seats'] : 1,
      luggage: ride['luggage'] === true, reward_model: ride['reward_model'] === 'expense_share' ? 'expense_share' : 'free',
      cost_share_ils: typeof ride['cost_share_ils'] === 'number' ? ride['cost_share_ils'] : null,
    },
    direction,
    places.get(placeRefKey(ref(ride, 'origin'))) ?? null,
    places.get(placeRefKey(ref(ride, 'dest'))) ?? null,
    stops,
  );
  delete details['departs_at'];
  return {
    id: row.id,
    direction: direction === 'request' ? 'request' : 'give',
    title: typeof post['title'] === 'string' ? post['title'] : '',
    details,
    schedule: { weekdays: rideWeekdaysFromMask(row.weekdays), time: row.depart_time.slice(0, 5), endsOn: row.ends_on },
    durationMinutes: row.duration_minutes,
    status: row.status,
  };
}
