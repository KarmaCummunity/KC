-- Worlds · notification kinds emitted by this module
--
-- Booking changes of rides, stays and events need no rows here: they are the
-- `<machine>_<change>` kinds registered with the registry (50_notifications/010), and
-- `post_expiring` (food about to expire) is registered there too. These are the kinds
-- only this module emits.

insert into kc_private.notification_kinds
  (kind, category, bypass_preferences, bypass_quiet_hours, title_key, body_key)
values
  -- A new ride along a saved route (D74). Held during quiet hours unless delivery decides
  -- otherwise from `data.departs_at` (D95).
  ('ride_route_match', 'critical', false, false,
   'notifications.rideRouteMatchTitle', 'notifications.rideRouteMatchBody'),
  -- An emergency call on a ride or stay the member takes part in: a safety notice,
  -- delivered whatever the member switched off and at any hour.
  ('post_emergency', 'critical', true, true,
   'notifications.postEmergencyTitle', 'notifications.postEmergencyBody'),
  -- A message from the organizer of an event the member registered for.
  ('event_organizer_message', 'critical', false, false,
   'notifications.eventOrganizerMessageTitle', 'notifications.eventOrganizerMessageBody'),
  -- The member's own post expired (S4: "and at expiry").
  ('post_expired', 'critical', false, false,
   'notifications.postExpiredTitle', 'notifications.postExpiredBody');
