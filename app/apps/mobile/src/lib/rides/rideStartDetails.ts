// Where a new ride starts from (docs/spec/05_giving_worlds.md §5.3 step 1, D75):
//   1. "publish again" on a past ride — its route and offer, queued just before opening the form;
//   2. otherwise the last route this device published.
// Times are never carried over (rideRepublishSeed drops them).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rideRepublishSeed } from '@kc/domain';

const LAST_ROUTE_KEY = 'kc.rides.lastRoute.v1';

/** A "publish again" seed waiting for the create form to open; consumed once. */
let queuedRepublish: Record<string, unknown> | null = null;

export function queueRideRepublish(details: Record<string, unknown>): void {
  queuedRepublish = rideRepublishSeed(details);
}

/** The details a new ride form starts with, or null for an empty form. */
export async function takeRideStartDetails(): Promise<Record<string, unknown> | null> {
  if (queuedRepublish) {
    const seed = queuedRepublish;
    queuedRepublish = null;
    return seed;
  }
  try {
    const raw = await AsyncStorage.getItem(LAST_ROUTE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A missing or corrupt memory just means an empty form.
    return null;
  }
}

/** Remembers a published ride's route and offer for the next ride from this device. */
export async function rememberRideRoute(details: Record<string, unknown>): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(rideRepublishSeed(details)));
  } catch {
    // Not remembering is harmless: the next form simply starts empty.
  }
}
