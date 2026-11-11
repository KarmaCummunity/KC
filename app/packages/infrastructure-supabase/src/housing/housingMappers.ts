// Row → domain mappers for housing bookings on the baseline: a booking is a `post_handoffs` row of
// machine `housing_booking` with its `handoff_booking_details` row (supabase/schemas/70_worlds/110).
import {
  isHousingBookingStatus,
  isHousingCancelReason,
  type HousingBookingStatus,
  type HousingGuestStay,
  type HousingHostBooking,
  type HousingPrivateDetails,
} from '@kc/domain';
import type { Database } from '../database.types';
import { parseWkbPoint } from '../posts/postMapPoint';

type Tables = Database['public']['Tables'];
export type HandoffRow = Tables['post_handoffs']['Row'];
export type BookingDetailsRow = Tables['handoff_booking_details']['Row'];
export type PrivateLocationRow = Tables['post_private_locations']['Row'];
export type GuestRow = Pick<Tables['users']['Row'], 'id' | 'display_name' | 'avatar_url' | 'verification_level' | 'created_at'>;
export type StayPostRow = Pick<Tables['posts']['Row'], 'id' | 'title' | 'city_id'>;

/** Identity level from which a member counts as verified (an identity document, D30). */
const VERIFIED_LEVEL = 2;
/** The exact place stays open to a confirmed guest until 24 hours after the stay (S53). */
const ADDRESS_GRACE_MS = 24 * 60 * 60 * 1000;

/** The booking window of a handoff and its details, as the domain names it. */
function stayDates(handoff: HandoffRow, details: BookingDetailsRow) {
  return {
    checkInDate: details.check_in_date,
    checkOutDate: details.check_out_date,
    startsAt: handoff.slot_starts_at ?? '',
    endsAt: handoff.slot_ends_at ?? '',
  };
}

/** One booking on an offer for its host; null for a status outside the housing set. */
export function mapHostBooking(
  handoff: HandoffRow,
  details: BookingDetailsRow,
  guest: GuestRow | null,
  completedStays: number,
  ratedByMe: boolean,
): HousingHostBooking | null {
  if (!isHousingBookingStatus(handoff.status)) return null;
  return {
    ...stayDates(handoff, details),
    handoffId: handoff.id,
    guestId: handoff.recipient_id,
    guestName: guest?.display_name ?? '',
    guestAvatarUrl: guest?.avatar_url ?? null,
    guestVerified: (guest?.verification_level ?? 0) >= VERIFIED_LEVEL,
    guestCompletedStays: completedStays,
    guestMemberSince: guest?.created_at ?? '',
    adults: details.adults,
    minors: details.minors,
    message: details.message,
    status: handoff.status,
    reservedAt: handoff.created_at,
    confirmBy: handoff.confirm_by,
    ratedByMe,
  };
}

/** Whether the server releases the exact place to the guest now (get_post_private_location). */
export function guestMayViewAddress(status: HousingBookingStatus, slotEndsAt: string | null, now: Date): boolean {
  if (status !== 'confirmed' && status !== 'handed_over') return false;
  return slotEndsAt === null || Date.parse(slotEndsAt) + ADDRESS_GRACE_MS > now.getTime();
}

/** One of the guest's own bookings; null for a status outside the housing set. */
export function mapGuestStay(
  handoff: HandoffRow,
  details: BookingDetailsRow,
  post: StayPostRow | null,
  hostName: string | null,
  ratedByMe: boolean,
  now: Date,
): HousingGuestStay | null {
  if (!isHousingBookingStatus(handoff.status)) return null;
  const reason = handoff.cancel_reason;
  return {
    ...stayDates(handoff, details),
    handoffId: handoff.id,
    listingId: handoff.post_id,
    listingTitle: post?.title ?? '',
    cityId: post?.city_id ?? null,
    hostId: handoff.owner_id,
    hostName: hostName ?? '',
    adults: details.adults,
    minors: details.minors,
    status: handoff.status,
    cancelReason: reason && isHousingCancelReason(reason) ? reason : null,
    reservedAt: handoff.created_at,
    confirmBy: handoff.confirm_by,
    canViewAddress: guestMayViewAddress(handoff.status, handoff.slot_ends_at, now),
    ratedByMe,
  };
}

/**
 * The exact place of a stay offer. The baseline keeps one free-text `access_notes` for everything a
 * guest needs on arrival (apartment, floor, entrance, access), so it comes back as the access
 * instructions and the separate fields stay empty.
 */
export function mapPrivateDetails(row: PrivateLocationRow, cityId: string): HousingPrivateDetails {
  const point = parseWkbPoint(row.exact_point);
  return {
    listingId: row.post_id,
    cityId,
    streetName: row.street ?? '',
    houseNumber: row.street_number ?? '',
    apartment: null,
    floor: null,
    entranceNotes: null,
    accessInstructions: row.access_notes ?? null,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
  };
}

/** The arrival notes the host typed, one per line, in the order the guest needs them. */
export function foldAccessNotes(parts: readonly (string | null | undefined)[]): string | null {
  const lines = parts.map((part) => part?.trim() ?? '').filter((part) => part.length > 0);
  return lines.length > 0 ? lines.join('\n') : null;
}

/** EWKT of a point for a `geography(Point, 4326)` column; null when either coordinate is missing. */
export function pointEwkt(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return `SRID=4326;POINT(${lng} ${lat})`;
}
