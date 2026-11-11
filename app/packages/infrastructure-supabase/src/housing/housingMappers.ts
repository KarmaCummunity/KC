// Row → domain mappers for the housing RPCs (migrations 0601, 0603).
import {
  isHousingBookingStatus,
  isHousingCancelReason,
  type HousingGuestStay,
  type HousingHostBooking,
  type HousingPrivateDetails,
} from '@kc/domain';
import type { Database } from '../database.legacy.types';

type Fns = Database['public']['Functions'];
export type HostBookingRow = Fns['list_housing_bookings']['Returns'][number];
export type GuestStayRow = Fns['list_my_housing_stays']['Returns'][number];
export type PrivateDetailsRow = Fns['get_housing_private_details']['Returns'][number];

/** One `list_housing_bookings` row; a status outside the housing set is dropped. */
export function mapHostBookingRow(row: HostBookingRow): HousingHostBooking | null {
  if (!isHousingBookingStatus(row.status)) return null;
  return {
    handoffId: row.handoff_id,
    guestId: row.recipient_id,
    guestName: row.guest_name ?? '',
    guestAvatarUrl: row.avatar_url ?? null,
    guestVerified: row.guest_verified === true,
    guestCompletedStays: Number(row.guest_completed_stays ?? 0),
    guestMemberSince: row.guest_member_since,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    startsAt: row.slot_starts_at,
    endsAt: row.slot_ends_at,
    adults: row.adults,
    minors: row.minors,
    message: row.message ?? '',
    status: row.status,
    reservedAt: row.reserved_at,
    confirmBy: row.confirm_by ?? null,
    ratedByMe: row.rated_by_me === true,
  };
}

/** One `list_my_housing_stays` row; a status outside the housing set is dropped. */
export function mapGuestStayRow(row: GuestStayRow): HousingGuestStay | null {
  if (!isHousingBookingStatus(row.status)) return null;
  return {
    handoffId: row.handoff_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title ?? '',
    cityId: row.city_id ?? null,
    hostId: row.host_id,
    hostName: row.host_name ?? '',
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    startsAt: row.slot_starts_at,
    endsAt: row.slot_ends_at,
    adults: row.adults,
    minors: row.minors,
    status: row.status,
    cancelReason: row.cancel_reason && isHousingCancelReason(row.cancel_reason) ? row.cancel_reason : null,
    reservedAt: row.reserved_at,
    confirmBy: row.confirm_by ?? null,
    canViewAddress: row.can_view_address === true,
    ratedByMe: row.rated_by_me === true,
  };
}

export function mapPrivateDetailsRow(row: PrivateDetailsRow): HousingPrivateDetails {
  return {
    listingId: row.listing_id,
    cityId: row.city_id,
    streetName: row.street_name ?? '',
    houseNumber: row.house_number,
    apartment: row.apartment ?? null,
    floor: row.floor ?? null,
    entranceNotes: row.entrance_notes ?? null,
    accessInstructions: row.access_instructions ?? null,
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
  };
}
