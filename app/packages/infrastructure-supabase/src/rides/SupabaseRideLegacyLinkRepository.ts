import type { SupabaseClient } from '@supabase/supabase-js';
import type { IRideLegacyLinkRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;

/** Legacy ride → listing over `listings.legacy_ride_id` (RLS decides what the caller may see). */
export class SupabaseRideLegacyLinkRepository implements IRideLegacyLinkRepository {
  constructor(private readonly client: Client) {}

  async listingIdForLegacyRide(rideId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('listings')
      .select('listing_id')
      .eq('legacy_ride_id', rideId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.listing_id ?? null;
  }
}
