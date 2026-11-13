// English copy for the baseline reasons of the posts, handoffs and worlds RPCs (supabase/schemas
// 20_posts, 25_handoffs, 70_worlds). Merged into `marketplace.errors` next to
// donations.marketplaceErrors.ts; keys mirror MARKETPLACE_SERVER_ERROR_CODES in @kc/domain.
export const marketplaceBaselineErrorsEn = {
  declaration_required: 'To offer a ride, confirm the driver declaration first.',
  ride_seats_below_bookings: 'More seats are already booked than the new number.',
  not_ride_offer: 'Seats can be booked only on a ride offer.',
  ride_series_schedule_invalid: 'The recurring ride schedule is not valid. Check the time, the days and the end date.',
  event_time_invalid: 'The event must start in the future and end after it starts.',
  event_capacity_below_registrations: 'More people have already registered than the new number.',
  event_message_invalid: 'Write a message to the registrants, up to 500 characters.',
  food_expiry_in_past: 'That expiry time has passed. Choose a future date and time.',
  knowledge_slots_limit: 'You can add up to 20 time slots.',
  housing_active_booking_conflict: 'Confirmed stays already use this space, so it cannot be reduced right now.',
  handoff_already_rated: 'You already rated this handoff. Thank you!',
  handoff_world_not_supported: 'This action is only for handing over an item or food.',
  emergency_not_active: 'You can call for help only during a ride or stay you are part of.',
  post_details_mismatch: 'The post details do not match its type. Check the fields and try again.',
  post_details_not_supported: 'This kind of post cannot be published from this form.',
  post_details_required: 'Some post details are missing. Fill in all the fields and try again.',
  post_kind_not_allowed: 'This post type is not available right now. Choose another one.',
  post_limit_exceeded: 'You already have 20 active posts. Close or delete one before publishing a new one.',
  post_not_found: 'This post no longer exists.',
  consent_version_stale: 'The wording was updated. Read the new version and confirm again.',
  rate_limited: 'Too many attempts in a row. Try again in a moment.',
  unauthenticated: 'Please sign in again to continue.',
} as const;
