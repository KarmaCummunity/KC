import type { SupabaseClient } from '@supabase/supabase-js';
import type { IRideSafetyRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;

/**
 * Ride safety over `ride_listing_emergency` (0517; docs/spec/05_giving_worlds.md §5.3, D70).
 * Server refusals keep their code (`ride_not_active`, `emergency_throttled`, …) for the UI.
 */
export class SupabaseRideSafetyRepository implements IRideSafetyRepository {
  constructor(private readonly client: Client) {}

  async raiseEmergency(listingId: string, note: string | null): Promise<void> {
    const { error } = await this.client.rpc('ride_listing_emergency', {
      p_listing_id: listingId,
      p_note: note ?? undefined,
    });
    if (error) throw new Error(error.message);
  }
}
