import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RIDE_SERIES_STATUSES,
  rideWeekdaysFromMask,
  rideWeekdaysToMask,
  type CreateRideSeriesInput,
  type CreatedRideSeries,
  type RideSeries,
  type RideSeriesSchedule,
  type RideSeriesStatus,
} from '@kc/domain';
import type { IRideSeriesRepository } from '@kc/application';
import type { Database, Json } from '../database.types';

type Client = SupabaseClient<Database>;
type SeriesRow = Database['public']['Tables']['ride_series']['Row'];

const COLUMNS = 'series_id, direction, title, details, depart_time, weekdays, duration_minutes, ends_on, status';

/**
 * Recurring rides over `ride_series` (0529; RLS: own rows for reading) and its RPCs, which own
 * the occurrences: `create_ride_series`, `set_ride_series_status`, `update_ride_series`.
 */
export class SupabaseRideSeriesRepository implements IRideSeriesRepository {
  constructor(private readonly client: Client) {}

  async listMine(): Promise<RideSeries[]> {
    const { data, error } = await this.client
      .from('ride_series')
      .select(COLUMNS)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as SeriesRow[]).flatMap((row) => {
      const series = mapRideSeriesRow(row);
      return series ? [series] : [];
    });
  }

  async create(input: CreateRideSeriesInput): Promise<CreatedRideSeries> {
    const { data, error } = await this.client.rpc('create_ride_series', {
      p_kind_id: input.kindId,
      p_title: input.title,
      p_details: input.details as Json,
      p_direction: input.direction,
      p_depart_time: input.schedule.time,
      p_weekdays: rideWeekdaysToMask(input.schedule.weekdays),
      p_summary: input.summary ?? undefined,
      p_duration_minutes: input.durationMinutes ?? undefined,
      p_ends_on: input.schedule.endsOn ?? undefined,
    });
    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row) throw new Error('create_ride_series returned no row');
    return { seriesId: row.series_id, firstListingId: row.first_listing_id };
  }

  async setStatus(seriesId: string, status: RideSeriesStatus): Promise<void> {
    const { error } = await this.client.rpc('set_ride_series_status', { p_series_id: seriesId, p_status: status });
    if (error) throw new Error(error.message);
  }

  async updateSchedule(seriesId: string, schedule: RideSeriesSchedule, durationMinutes: number | null): Promise<void> {
    const { error } = await this.client.rpc('update_ride_series', {
      p_series_id: seriesId,
      p_depart_time: schedule.time,
      p_weekdays: rideWeekdaysToMask(schedule.weekdays),
      p_duration_minutes: durationMinutes ?? undefined,
      p_ends_on: schedule.endsOn ?? undefined,
    });
    if (error) throw new Error(error.message);
  }
}

function isStatus(value: string): value is RideSeriesStatus {
  return (RIDE_SERIES_STATUSES as readonly string[]).includes(value);
}

/** Maps one row; a row of an unknown direction or status is dropped. `depart_time` arrives as `HH:MM:SS`. */
export function mapRideSeriesRow(row: SeriesRow): RideSeries | null {
  if ((row.direction !== 'give' && row.direction !== 'request') || !isStatus(row.status)) return null;
  return {
    id: row.series_id,
    direction: row.direction,
    title: row.title,
    details: (row.details as Record<string, unknown> | null) ?? {},
    schedule: {
      weekdays: rideWeekdaysFromMask(row.weekdays),
      time: row.depart_time.slice(0, 5),
      endsOn: row.ends_on,
    },
    durationMinutes: row.duration_minutes,
    status: row.status,
  };
}
