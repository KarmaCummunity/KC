import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideHouseNumberEnd, RideHouseNumbers } from '@kc/domain';
import type { IRideHouseNumberRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;

const isEnd = (v: unknown): v is RideHouseNumberEnd => v === 'origin' || v === 'dest';

/**
 * Private house numbers (0638): `set_ride_house_numbers` (owner only) and
 * `get_ride_house_numbers` (owner + approved passengers; no rows for anyone else).
 */
export class SupabaseRideHouseNumberRepository implements IRideHouseNumberRepository {
  constructor(private readonly client: Client) {}

  async save(listingId: string, numbers: RideHouseNumbers): Promise<void> {
    const { error } = await this.client.rpc('set_ride_house_numbers', {
      p_listing_id: listingId,
      p_origin: numbers.origin?.trim() || undefined,
      p_dest: numbers.dest?.trim() || undefined,
    });
    if (error) throw new Error(error.message);
  }

  async get(listingId: string): Promise<RideHouseNumbers> {
    const { data, error } = await this.client.rpc('get_ride_house_numbers', { p_listing_id: listingId });
    if (error) throw new Error(error.message);
    const out: Partial<Record<RideHouseNumberEnd, string>> = {};
    for (const row of data ?? []) {
      if (isEnd(row.place_end) && row.house_number) out[row.place_end] = row.house_number;
    }
    return out;
  }
}
