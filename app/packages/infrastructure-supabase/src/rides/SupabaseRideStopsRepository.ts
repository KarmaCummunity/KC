// SupabaseRideStopsRepository — adapter for IRideStopsRepository (FR-RIDE-030).
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IRideStopsRepository,
  SetRideStopsInput,
} from '@kc/application';
import type { RideStop } from '@kc/domain';
import { RideError } from '@kc/domain';
import type { Database } from '../database.legacy.types';

const STOPS_SELECT =
  '*, city:cities!ride_stops_city_id_fkey(name_he)';

type StopRow = Database['public']['Tables']['ride_stops']['Row'] & {
  city: { name_he: string } | null;
};

function mapStop(row: StopRow): RideStop {
  return {
    stopId: row.stop_id,
    rideId: row.ride_id,
    sortOrder: row.sort_order,
    cityId: row.city_id,
    cityName: row.city?.name_he ?? '',
    street: row.street,
    notes: row.notes,
  };
}

export class SupabaseRideStopsRepository implements IRideStopsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listForRide(rideId: string): Promise<readonly RideStop[]> {
    const { data, error } = await this.client
      .from('ride_stops')
      .select(STOPS_SELECT)
      .eq('ride_id', rideId)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as StopRow[]).map(mapStop);
  }

  async setStops(input: SetRideStopsInput): Promise<readonly RideStop[]> {
    // Replace-all semantics: delete existing rows, then insert the new list.
    const { error: delErr } = await this.client
      .from('ride_stops')
      .delete()
      .eq('ride_id', input.rideId);
    if (delErr) throw new Error(delErr.message);

    if (input.stops.length === 0) return [];

    const rows = input.stops.map((s) => ({
      ride_id: input.rideId,
      sort_order: s.sortOrder,
      city_id: s.cityId,
      street: s.street ?? null,
      notes: s.notes ?? null,
    }));
    const { data, error } = await this.client
      .from('ride_stops')
      .insert(rows)
      .select(STOPS_SELECT);
    if (error) {
      const msg = (error.message ?? '').toLowerCase();
      if (msg.includes('stop_matches_endpoint')) {
        throw new RideError('stop_matches_endpoint', error.message);
      }
      throw new Error(error.message);
    }
    return ((data ?? []) as StopRow[]).map(mapStop);
  }
}
