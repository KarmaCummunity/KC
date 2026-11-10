// FR-RIDE-003 AC9 — the private house numbers of a ride the viewer may see (driver or approved
// passenger); empty for everyone else and for guests.
import { useQuery } from '@tanstack/react-query';
import type { RideHouseNumbers } from '@kc/domain';
import { rideHouseNumberUseCases, rideHouseNumbersQueryKey } from '../services/rideHouseNumberComposition';
import { useAuthStore } from '../store/authStore';

const NONE: RideHouseNumbers = {};

export function useRideHouseNumbers(listingId: string, enabled: boolean): RideHouseNumbers {
  const signedIn = useAuthStore((s) => Boolean(s.session?.userId));
  const query = useQuery({
    queryKey: rideHouseNumbersQueryKey(listingId),
    queryFn: () => rideHouseNumberUseCases.get().execute(listingId),
    enabled: enabled && signedIn,
  });
  return query.data ?? NONE;
}
