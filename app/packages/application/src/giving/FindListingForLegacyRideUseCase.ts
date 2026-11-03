// Old links to a retired legacy ride (pushes, chat cards) open its listing on the one rides
// flow instead (docs/spec/05_giving_worlds.md §5.3, D70; gap G44).
import type { IRideLegacyLinkRepository } from '../ports/IRideLegacyLinkRepository';

/** A ride id is a UUID; anything else cannot be a legacy ride. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FindListingForLegacyRideUseCase {
  constructor(private readonly repo: IRideLegacyLinkRepository) {}
  execute(rideId: string | null | undefined): Promise<string | null> {
    if (!rideId || !UUID.test(rideId)) return Promise.resolve(null);
    return this.repo.listingIdForLegacyRide(rideId);
  }
}
