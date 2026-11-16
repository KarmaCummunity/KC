// The street address of a listing that happens at a place (an event). The server owns who may
// read and write; these refuse an incomplete or invalid address before the round trip and delegate.
import { ValidationError, listingStreetAddressIssue, type ListingStreetAddress } from '@kc/domain';
import type { IListingStreetAddressRepository } from '../ports/IListingStreetAddressRepository';

export class SaveListingStreetAddressUseCase {
  constructor(private readonly repo: IListingStreetAddressRepository) {}
  async execute(listingId: string, address: ListingStreetAddress): Promise<void> {
    const issue = listingStreetAddressIssue(address);
    if (issue) throw new ValidationError(`listing_street_address_${issue}`, 'address');
    await this.repo.save(listingId, { street: address.street.trim(), streetNumber: address.streetNumber.trim() });
  }
}

export class GetOwnListingStreetAddressUseCase {
  constructor(private readonly repo: IListingStreetAddressRepository) {}
  execute(listingId: string): Promise<ListingStreetAddress | null> {
    return this.repo.getOwn(listingId);
  }
}
