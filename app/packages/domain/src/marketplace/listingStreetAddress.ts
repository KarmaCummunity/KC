// The street address of a listing that happens at a place (an event): the street and the house
// number, next to the listing's city. Same parts and the same rules as an items post's address
// (`Address`, `STREET_NUMBER_PATTERN`), so every post stores its place the same way. Pure.
import { STREET_NUMBER_PATTERN } from '../value-objects';

export interface ListingStreetAddress {
  readonly street: string;
  readonly streetNumber: string;
}

/** What is wrong with a street address, in the order the form reports it. */
export type ListingStreetAddressIssue = 'streetAndNumber' | 'street' | 'streetNumber' | 'streetNumberInvalid';

/** The first problem of the address; null when both parts are present and the number is valid. */
export function listingStreetAddressIssue(address: ListingStreetAddress): ListingStreetAddressIssue | null {
  const street = address.street.trim();
  const streetNumber = address.streetNumber.trim();
  if (street.length === 0 && streetNumber.length === 0) return 'streetAndNumber';
  if (street.length === 0) return 'street';
  if (streetNumber.length === 0) return 'streetNumber';
  return STREET_NUMBER_PATTERN.test(streetNumber) ? null : 'streetNumberInvalid';
}

/** The address as one line ("Herzl 12"), the text an event shows as its place. */
export function listingStreetAddressLabel(address: ListingStreetAddress): string {
  return `${address.street.trim()} ${address.streetNumber.trim()}`.trim();
}
