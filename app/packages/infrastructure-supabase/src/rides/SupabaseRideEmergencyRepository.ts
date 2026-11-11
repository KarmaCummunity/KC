// FR-RIDE-035 — adapter for IRideEmergencyRepository.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IRideEmergencyRepository,
  TriggerRideEmergencyInput,
} from '@kc/application';
import type { RideEmergencyEvent } from '@kc/domain';
import { RideError } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type Row = Database['public']['Tables']['ride_emergency_events']['Row'];

function map(row: Row): RideEmergencyEvent {
  return {
    eventId: row.event_id,
    rideId: row.ride_id,
    triggeredBy: row.triggered_by,
    triggeredAt: row.triggered_at,
    lat: row.lat,
    lng: row.lng,
    note: row.note,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export class SupabaseRideEmergencyRepository implements IRideEmergencyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async trigger(input: TriggerRideEmergencyInput): Promise<RideEmergencyEvent> {
    const { data, error } = await this.client.rpc('rpc_ride_emergency_trigger', {
      p_ride_id: input.rideId,
      p_lat: input.lat ?? undefined,
      p_lng: input.lng ?? undefined,
      p_note: input.note ?? undefined,
    });
    if (error) {
      const code = (error.message ?? '').trim();
      switch (code) {
        case 'auth_required':
        case 'ride_not_found':
        case 'ride_not_in_transit':
        case 'not_ride_participant':
        case 'emergency_throttled':
          throw new RideError(code as never, code);
        default:
          throw new Error(error.message);
      }
    }
    if (!data) throw new Error('emergency_trigger: empty response');
    return map(data as Row);
  }

  async listForRide(rideId: string): Promise<readonly RideEmergencyEvent[]> {
    const { data, error } = await this.client
      .from('ride_emergency_events')
      .select('*')
      .eq('ride_id', rideId)
      .order('triggered_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(map);
  }
}
