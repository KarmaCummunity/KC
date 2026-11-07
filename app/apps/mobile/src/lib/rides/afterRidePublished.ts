// What follows publishing a single ride: remember the route for next time (D75), store its
// private house numbers (FR-RIDE-003 AC9) and, for a driver leaving now from here, open Waze
// (AC8). A failure here never undoes the published ride.
import { readRideRoute, rideHouseNumbersForSubmit, type RideHouseNumbers, type RidePublishedFlags } from '@kc/domain';
import { rideHouseNumberUseCases } from '../../services/rideHouseNumberComposition';
import { rememberRideRoute } from './rideStartDetails';
import { navigateAfterRidePublish } from './navigateAfterRidePublish';

export async function afterRidePublished(
  listingId: string,
  details: Readonly<Record<string, unknown>>,
  houseNumbers: RideHouseNumbers,
  flags: RidePublishedFlags,
): Promise<void> {
  void rememberRideRoute(details);
  const numbers = rideHouseNumbersForSubmit(readRideRoute(details), houseNumbers);
  if (numbers.origin || numbers.dest) {
    await rideHouseNumberUseCases.save().execute(listingId, numbers).catch(() => undefined);
  }
  void navigateAfterRidePublish(details, flags, numbers);
}
