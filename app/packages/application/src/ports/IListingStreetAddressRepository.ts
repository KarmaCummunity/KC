import type { ListingStreetAddress } from '@kc/domain';

/**
 * The street and house number of a listing that happens at a place (an event), stored like every
 * post's address: in the post's private location, next to the post's city.
 */
export interface IListingStreetAddressRepository {
  /** Owner only. Accepts a listing id or a post id. */
  save(listingId: string, address: ListingStreetAddress): Promise<void>;
  /** The address the owner stored; null for anybody else, or when none is stored. */
  getOwn(listingId: string): Promise<ListingStreetAddress | null>;
}
