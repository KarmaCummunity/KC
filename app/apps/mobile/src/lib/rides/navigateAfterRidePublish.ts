// FR-RIDE-003 AC8: a driver who publishes a single offer leaving now from the device's location
// is sent straight to Waze, navigating to the ride's next stop (with its private house number,
// AC9, when the stop is the destination street).
import { Linking } from 'react-native';
import {
  readRideRoute,
  rideNavigationUrl,
  rideNextStop,
  shouldNavigateAfterRidePublish,
  type RideHouseNumbers,
  type RidePublishedFlags,
} from '@kc/domain';

/** Opens Waze for the published ride when the flags call for it; never throws. */
export async function navigateAfterRidePublish(
  details: Readonly<Record<string, unknown>>,
  flags: RidePublishedFlags,
  houseNumbers: RideHouseNumbers = {},
): Promise<boolean> {
  if (!shouldNavigateAfterRidePublish(flags)) return false;
  const route = readRideRoute(details);
  const stop = rideNextStop(route);
  if (!stop) return false;
  const houseNumber = stop === route.dest ? houseNumbers.dest : undefined;
  try {
    await Linking.openURL(rideNavigationUrl('waze', stop, houseNumber));
    return true;
  } catch {
    return false;
  }
}
