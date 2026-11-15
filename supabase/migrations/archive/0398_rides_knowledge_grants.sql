-- 0398: grants + comment registry for rides/knowledge RPCs.

begin;

comment on function public.find_ride_listing_matches is
  'PostGIS corridor match for rides listings (origin+dest within radius_km).';
comment on function public.book_ride_seat is
  'Reserve seats on a ride_offer listing via giving_handoffs.';
comment on function public.complete_ride_trip is
  'Mark ride handoff handed_over and award driver + passenger karma (karma_grant_once).';
comment on function public.book_knowledge_slot is
  'Book one slot on a knowledge give listing via giving_handoffs.';
comment on function public.complete_knowledge_session is
  'Complete a knowledge session handoff + mentor/learner karma (karma_grant_once).';
comment on function public.confirm_ride_booking is
  'Driver confirms a reserved ride seat.';
comment on function public.cancel_ride_booking is
  'Driver or passenger cancels a reserved/confirmed ride seat.';

commit;
