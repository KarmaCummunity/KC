// Housing stays — the domain shapes of a stay booking as the host and the guest see it.
// Spec: docs/spec/requirements/21_housing.md FR-HOUSING-012 (private details), 015–021 (booking
// lifecycle), 036 (my hosting) and 037 (my stays). Server: migrations 0600–0603.

/** Every state a housing booking can reach on the generic handoff stage. */
export const HOUSING_BOOKING_STATUSES = ['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const;
export type HousingBookingStatus = (typeof HOUSING_BOOKING_STATUSES)[number];

/** Why a cancelled booking ended (`giving_handoffs.cancel_reason`, housing values). */
export const HOUSING_CANCEL_REASONS = [
  'declined',
  'expired',
  'superseded',
  'guest_cancelled',
  'host_cancelled',
  'not_completed',
  'system',
] as const;
export type HousingCancelReason = (typeof HOUSING_CANCEL_REASONS)[number];

/** Time window of a booking: local calendar days plus the instants the server computed. */
export interface HousingStayDates {
  /** Check-in day, `yyyy-MM-dd` (Israel). */
  readonly checkInDate: string;
  /** Check-out day, `yyyy-MM-dd` (Israel); the night before it is the last one. */
  readonly checkOutDate: string;
  /** Check-in instant (the offer's `check_in_from` on the check-in day), ISO. */
  readonly startsAt: string;
  /** Check-out instant (the offer's `check_out_by` on the check-out day), ISO. */
  readonly endsAt: string;
}

/** One booking on an offer, as its host manages it (`list_housing_bookings`). */
export interface HousingHostBooking extends HousingStayDates {
  readonly handoffId: string;
  readonly guestId: string;
  readonly guestName: string;
  readonly guestAvatarUrl: string | null;
  /** Trust block (S16, D24): verification, completed stays and seniority — never ratings. */
  readonly guestVerified: boolean;
  readonly guestCompletedStays: number;
  readonly guestMemberSince: string;
  readonly adults: number;
  readonly minors: number;
  readonly message: string;
  readonly status: HousingBookingStatus;
  readonly reservedAt: string;
  /** Deadline for the host's answer (24 h or check-in, whichever is earlier). */
  readonly confirmBy: string | null;
  readonly ratedByMe: boolean;
}

/** One of the guest's own bookings (`list_my_housing_stays`). */
export interface HousingGuestStay extends HousingStayDates {
  readonly handoffId: string;
  readonly listingId: string;
  readonly listingTitle: string;
  readonly cityId: string | null;
  readonly hostId: string;
  readonly hostName: string;
  readonly adults: number;
  readonly minors: number;
  readonly status: HousingBookingStatus;
  readonly cancelReason: HousingCancelReason | null;
  readonly reservedAt: string;
  readonly confirmBy: string | null;
  /** True while the server lets this guest read the exact place (FR-HOUSING-012 AC2). */
  readonly canViewAddress: boolean;
  readonly ratedByMe: boolean;
}

/** The exact place of an offer, revealed to the host and the confirmed guest only. */
export interface HousingPrivateDetails {
  readonly listingId: string;
  readonly cityId: string;
  readonly streetName: string;
  readonly houseNumber: string;
  readonly apartment: string | null;
  readonly floor: string | null;
  readonly entranceNotes: string | null;
  readonly accessInstructions: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
}

/** What a guest sends to request a stay (FR-HOUSING-015 AC1). */
export interface HousingStayRequestInput {
  readonly listingId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly adults: number;
  readonly minors: number;
  readonly message: string;
  /** Required when minors > 0: a parent or guardian of every minor travels along (FR-HOUSING-026). */
  readonly minorsGuardianAck: boolean;
}

/** The host's terms a request is checked against, read from the offer's details. */
export interface HousingOfferTerms {
  readonly minNights: number;
  readonly maxNights: number;
  readonly childrenOk: boolean;
  readonly capacity: number;
}

export function isHousingBookingStatus(value: string): value is HousingBookingStatus {
  return (HOUSING_BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isHousingCancelReason(value: string): value is HousingCancelReason {
  return (HOUSING_CANCEL_REASONS as readonly string[]).includes(value);
}
