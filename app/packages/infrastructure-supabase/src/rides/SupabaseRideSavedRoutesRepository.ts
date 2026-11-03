import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RIDE_TIME_WINDOWS,
  isRidePlaceKind,
  maskToWeekdays,
  timeWindowFor,
  weekdaysToMask,
  type RidePlace,
  type RideSavedRoute,
  type SaveRideRouteInput,
} from '@kc/domain';
import type { IRideSavedRoutesRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type RouteRow = Database['public']['Tables']['ride_saved_routes']['Row'];

const COLUMNS =
  'route_id, wants, origin_place_kind, origin_place_id, origin_label, origin_lat, origin_lng, ' +
  'dest_place_kind, dest_place_id, dest_label, dest_lat, dest_lng, weekdays, time_from, time_to';

/**
 * Saved routes over `ride_saved_routes` (0516; RLS: own rows only). The server fills the
 * user, resolves both places from the official catalogs and enforces the 10-route cap.
 */
export class SupabaseRideSavedRoutesRepository implements IRideSavedRoutesRepository {
  constructor(private readonly client: Client) {}

  async listMine(): Promise<RideSavedRoute[]> {
    const { data, error } = await this.client
      .from('ride_saved_routes')
      .select(COLUMNS)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as RouteRow[]).flatMap((row) => {
      const route = mapRouteRow(row);
      return route ? [route] : [];
    });
  }

  async save(input: SaveRideRouteInput): Promise<void> {
    const hours = input.timeWindow ? RIDE_TIME_WINDOWS[input.timeWindow] : null;
    // Labels and coordinates are placeholders: the server overwrites them from the catalogs.
    const { error } = await this.client.from('ride_saved_routes').insert({
      wants: input.wants,
      origin_place_kind: input.origin.kind,
      origin_place_id: input.origin.id,
      origin_label: input.origin.label,
      origin_lat: input.origin.lat,
      origin_lng: input.origin.lng,
      dest_place_kind: input.dest.kind,
      dest_place_id: input.dest.id,
      dest_label: input.dest.label,
      dest_lat: input.dest.lat,
      dest_lng: input.dest.lng,
      weekdays: weekdaysToMask(input.weekdays),
      time_from: hours?.[0] ?? null,
      time_to: hours?.[1] ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async remove(routeId: string): Promise<void> {
    const { error } = await this.client.from('ride_saved_routes').delete().eq('route_id', routeId);
    if (error) throw new Error(error.message);
  }
}

function place(kind: string, id: string, label: string, lat: number, lng: number): RidePlace | null {
  return isRidePlaceKind(kind) ? { kind, id, label, lat, lng, cityId: null } : null;
}

/** Maps one row; a row with an unknown place kind is dropped. */
export function mapRouteRow(row: RouteRow): RideSavedRoute | null {
  const origin = place(row.origin_place_kind, row.origin_place_id, row.origin_label, row.origin_lat, row.origin_lng);
  const dest = place(row.dest_place_kind, row.dest_place_id, row.dest_label, row.dest_lat, row.dest_lng);
  if (!origin || !dest || (row.wants !== 'offers' && row.wants !== 'requests')) return null;
  return {
    id: row.route_id,
    wants: row.wants,
    origin,
    dest,
    weekdays: maskToWeekdays(row.weekdays),
    timeWindow: timeWindowFor(row.time_from, row.time_to),
  };
}
