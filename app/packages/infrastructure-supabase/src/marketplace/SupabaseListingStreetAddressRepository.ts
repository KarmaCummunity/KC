import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListingStreetAddress } from '@kc/domain';
import type { IListingStreetAddressRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

/**
 * Street and house number of a listing that happens at a place (an event), kept where every post
 * keeps them: `post_private_locations`. Row-level security lets only the post's owner write and
 * read the row; what other people see is derived by the server from the post's display level.
 */
export class SupabaseListingStreetAddressRepository implements IListingStreetAddressRepository {
  constructor(private readonly client: Client) {}

  /** Writes only the two address columns, so a row's other private details are kept. */
  async save(listingId: string, address: ListingStreetAddress): Promise<void> {
    unwrapCall(
      'table:post_private_locations',
      await this.client
        .from('post_private_locations')
        .upsert(
          { post_id: listingId, street: address.street, street_number: address.streetNumber },
          { onConflict: 'post_id' },
        ),
    );
  }

  /** Null when the caller is not the owner (the row is not readable) or no street is stored. */
  async getOwn(listingId: string): Promise<ListingStreetAddress | null> {
    const row = unwrapCall(
      'table:post_private_locations',
      await this.client
        .from('post_private_locations')
        .select('street, street_number')
        .eq('post_id', listingId)
        .maybeSingle(),
    );
    return row?.street ? { street: row.street, streetNumber: row.street_number ?? '' } : null;
  }
}
