import type { RideHouseNumbers } from '@kc/domain';

/** Private house numbers of a ride's street ends (FR-RIDE-003 AC9). */
export interface IRideHouseNumberRepository {
  /** Owner only; an end left out is cleared. Accepts a listing id or a post id. */
  save(listingId: string, numbers: RideHouseNumbers): Promise<void>;
  /** The numbers the caller may see: everything for the driver or an approved passenger, else none. */
  get(listingId: string): Promise<RideHouseNumbers>;
}
