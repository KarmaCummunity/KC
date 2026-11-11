import { DomainError } from '../errors';

export type RideErrorCode =
  | 'same_route'
  | 'origin_street_required'
  | 'dest_street_required'
  | 'seats_required'
  | 'seats_forbidden'
  | 'description_too_long'
  | 'city_not_found'
  | 'auth_required'
  | 'invalid_visibility'
  | 'ride_not_found'
  | 'not_ride_owner'
  | 'ride_not_open'
  | 'invalid_weekday_mask'
  | 'invalid_lookahead_days'
  | 'template_not_found'
  // FR-RIDE-026..030 — advanced publish.
  | 'cargo_invalid_bounds'
  | 'cargo_types_required'
  | 'cargo_food_mutually_exclusive'
  | 'food_invalid_bounds'
  | 'payment_cap_exceeded'
  | 'payment_amount_required'
  | 'payment_amount_forbidden'
  | 'invalid_payment_model'
  | 'invalid_gender_requirement'
  | 'stop_matches_endpoint'
  | 'stop_duplicate_city'
  | 'too_many_stops'
  // FR-RIDE-029 AC3.
  | 'requester_not_verified'
  // FR-RIDE-031..033 — active ride lifecycle.
  | 'invalid_status_transition'
  | 'start_window_not_open'
  | 'ride_not_in_transit'
  | 'arrive_failed'
  // FR-RIDE-035 — emergency.
  | 'emergency_throttled'
  // FR-RIDE-037 — ratings.
  | 'rating_window_closed'
  | 'rating_duplicate'
  | 'rating_not_participant'
  // FR-RIDE-041 — driver declaration.
  | 'declaration_required'
  // FR-RIDE-043 — minor consent.
  | 'minor_consent_required'
  // FR-RIDE-045 — international ride ban.
  | 'international_rides_banned'
  // Ride seat bookings (D73, 0393, 0511).
  | 'seats_exhausted'
  | 'invalid_status'
  | 'ride_departed'
  | 'ride_not_started'
  // Reinstating a booking (`reinstate_ride_booking`, 0667): the RPC's own refusal codes.
  | 'listing_not_available'
  | 'already_booked'
  | 'ride_seats_exhausted'
  // FR-RIDE-046 — recurring rides: the schedule a series needs.
  | 'series_weekdays_required'
  | 'series_time_invalid'
  | 'series_ends_in_past'
  // FR-RIDE-003 AC9 — private house numbers.
  | 'ride_house_number_invalid';

export class RideError extends DomainError {
  readonly code: RideErrorCode;

  constructor(code: RideErrorCode, message: string) {
    super(message, { code });
    this.code = code;
  }
}
