// Private house numbers of a ride (FR-RIDE-003 AC9). The server owns who may read and write;
// these refuse an invalid number before the round trip and delegate.
import { RideError, hasInvalidRideHouseNumber, type RideHouseNumbers } from '@kc/domain';
import type { IRideHouseNumberRepository } from '../ports/IRideHouseNumberRepository';

export class SaveRideHouseNumbersUseCase {
  constructor(private readonly repo: IRideHouseNumberRepository) {}
  async execute(listingId: string, numbers: RideHouseNumbers): Promise<void> {
    if (hasInvalidRideHouseNumber(numbers)) {
      throw new RideError('ride_house_number_invalid', 'ride_house_number_invalid');
    }
    await this.repo.save(listingId, numbers);
  }
}

export class GetRideHouseNumbersUseCase {
  constructor(private readonly repo: IRideHouseNumberRepository) {}
  execute(listingId: string): Promise<RideHouseNumbers> {
    return this.repo.get(listingId);
  }
}
