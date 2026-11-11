import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RIDE_TIME_WINDOWS,
  maskToWeekdays,
  timeWindowFor,
  weekdaysToMask,
  BackendRuleError,
  type RidePlace,
  type RideSavedRoute,
  type SaveRideRouteInput,
} from '@kc/domain';
import type { IRideSavedRoutesRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { placeRefKey, refOfPlace, resolvePlaces, type PlaceRef } from './ridePlaces';

type Client = SupabaseClient<Database>;
type RouteRow = Database['public']['Tables']['ride_saved_routes']['Row'];

const originOf = (row: RouteRow): PlaceRef => ({ cityId: row.origin_city_id, streetId: row.origin_street_id, junctionId: row.origin_junction_id });
const destOf = (row: RouteRow): PlaceRef => ({ cityId: row.dest_city_id, streetId: row.dest_street_id, junctionId: row.dest_junction_id });

/**
 * Saved routes over `ride_saved_routes` (RLS: own rows only). Both ends are official places; the
 * server derives their positions and enforces the ten-route cap (`saved_routes_limit`).
 */
export class SupabaseRideSavedRoutesRepository implements IRideSavedRoutesRepository {
  constructor(private readonly client: Client) {}

  async listMine(): Promise<RideSavedRoute[]> {
    const rows =
      unwrapCall('table:ride_saved_routes', await this.client.from('ride_saved_routes').select('*').order('created_at', { ascending: true })) ?? [];
    const places = await resolvePlaces(this.client, rows.flatMap((row) => [originOf(row), destOf(row)]));
    return rows.flatMap((row) => {
      const route = mapRouteRow(row, places);
      return route ? [route] : [];
    });
  }

  async save(input: SaveRideRouteInput): Promise<void> {
    const origin = refOfPlace(input.origin);
    const dest = refOfPlace(input.dest);
    if (!origin || !dest) throw new BackendRuleError('ride_place_invalid', 'table:ride_saved_routes');
    const hours = input.timeWindow ? RIDE_TIME_WINDOWS[input.timeWindow] : null;
    unwrapCall(
      'table:ride_saved_routes',
      await this.client.from('ride_saved_routes').insert({
        wants: input.wants,
        // The points are derived from the places by a trigger; the generated type still requires them.
        origin_point: null,
        dest_point: null,
        origin_city_id: origin.cityId,
        origin_street_id: origin.streetId,
        origin_junction_id: origin.junctionId,
        dest_city_id: dest.cityId,
        dest_street_id: dest.streetId,
        dest_junction_id: dest.junctionId,
        weekdays: weekdaysToMask(input.weekdays),
        time_from: hours?.[0] ?? null,
        time_to: hours?.[1] ?? null,
      }),
    );
  }

  async remove(routeId: string): Promise<void> {
    unwrapCall('table:ride_saved_routes', await this.client.from('ride_saved_routes').delete().eq('id', routeId));
  }
}

/** Maps one row; a row with an end the catalogs no longer hold, or an unknown `wants`, is dropped. */
export function mapRouteRow(row: RouteRow, places: ReadonlyMap<string, RidePlace>): RideSavedRoute | null {
  const origin = places.get(placeRefKey(originOf(row)));
  const dest = places.get(placeRefKey(destOf(row)));
  if (!origin || !dest || (row.wants !== 'offers' && row.wants !== 'requests')) return null;
  return {
    id: row.id,
    wants: row.wants,
    origin,
    dest,
    weekdays: maskToWeekdays(row.weekdays),
    timeWindow: timeWindowFor(row.time_from, row.time_to),
  };
}
