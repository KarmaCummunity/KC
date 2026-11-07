// Booking section of a ride offer screen: the driver manages every booking, a signed-in
// passenger books and follows their own (docs/spec/05_giving_worlds.md §5.3 step 3, D73).
// Ride requests have no bookings; a guest sees nothing until signing in.
import React from 'react';
import type { MarketplaceListingDetail } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { RideBookingsPanel } from './RideBookingsPanel';
import { RidePassengerBooking } from './RidePassengerBooking';
import { RideEmergencyButton } from './RideEmergencyButton';

interface Props {
  readonly detail: MarketplaceListingDetail;
  readonly hideOwnerAssign?: boolean;
}

/** Offered seats from the ride extension; a ride without the field offers one seat. */
export function rideCapacity(details: Record<string, unknown>): number {
  const raw = details['seats_available'];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export function RideBookingActions({ detail, hideOwnerAssign = false }: Props) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  if (detail.worldSlug !== 'rides' || detail.direction !== 'give' || !userId) return null;

  const capacity = rideCapacity(detail.details);
  return userId === detail.ownerId ? (
    <>
      {/* The driver is always on the ride: the emergency call shows while it is under way. */}
      <RideEmergencyButton listingId={detail.listingId} details={detail.details} />
      <RideBookingsPanel
        listingId={detail.listingId}
        cityId={detail.cityId}
        capacity={capacity}
        listingStatus={detail.listingStatus ?? ''}
        departsAt={typeof detail.details['departs_at'] === 'string' ? detail.details['departs_at'] : null}
        hideOwnerAssign={hideOwnerAssign}
      />
    </>
  ) : (
    <RidePassengerBooking listingId={detail.listingId} cityId={detail.cityId} capacity={capacity} details={detail.details} />
  );
}
