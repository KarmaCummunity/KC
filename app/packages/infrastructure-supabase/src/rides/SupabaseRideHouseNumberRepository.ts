import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideHouseNumbers } from '@kc/domain';
import type { IRideHouseNumberRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

/**
 * Private house numbers of a ride's street ends (FR-RIDE-003 AC9), kept in `post_private_locations`:
 * the owner writes `street_number` (origin) and `destination_street_number` (destination); the
 * driver and the passengers of a confirmed booking read them through `get_post_private_location`
 * (each release is audited by the server).
 */
export class SupabaseRideHouseNumberRepository implements IRideHouseNumberRepository {
  constructor(private readonly client: Client) {}

  /** Owner only; an end left out is cleared. */
  async save(listingId: string, numbers: RideHouseNumbers): Promise<void> {
    unwrapCall(
      'table:post_private_locations',
      await this.client.from('post_private_locations').upsert(
        {
          post_id: listingId,
          street_number: numbers.origin?.trim() || null,
          destination_street_number: numbers.dest?.trim() || null,
        },
        { onConflict: 'post_id' },
      ),
    );
  }

  /** The numbers the caller may see; nothing for a caller the server does not release them to. */
  async get(listingId: string): Promise<RideHouseNumbers> {
    const row = unwrapCall(
      'rpc:get_post_private_location',
      await this.client.rpc('get_post_private_location', { p_post_id: listingId }),
    );
    const out: { origin?: string; dest?: string } = {};
    if (row?.street_number) out.origin = row.street_number;
    if (row?.destination_street_number) out.dest = row.destination_street_number;
    return out;
  }
}
