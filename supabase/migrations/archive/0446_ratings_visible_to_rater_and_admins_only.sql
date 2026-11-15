-- 0446_ratings_visible_to_rater_and_admins_only
-- Project book D24 (docs/spec/07_cross_cutting_systems.md §7.7, gap G4):
-- users never see ratings — not even the ones about themselves. Only KC
-- admins read them (trust engine).
--
-- The rater keeps read access to the rows they wrote: the rate screen needs it
-- to hide people already rated (RateRideScreen `alreadyRatedIds`), and it
-- reveals nothing new to them. The ratee / handoff counterpart loses access.
-- `user_ride_rating_summary` is `security_invoker` (0179), so it follows.

drop policy if exists ride_ratings_select on public.ride_ratings;
create policy ride_ratings_select on public.ride_ratings
  for select to authenticated using (
    rater_id = (select auth.uid())
    or public.has_admin_role((select auth.uid()), 'super_admin')
  );

drop policy if exists giving_handoff_ratings_participant_read on public.giving_handoff_ratings;
drop policy if exists giving_handoff_ratings_rater_or_admin_read on public.giving_handoff_ratings;
create policy giving_handoff_ratings_rater_or_admin_read on public.giving_handoff_ratings
  for select to authenticated using (
    rater_id = (select auth.uid())
    or public.has_admin_role((select auth.uid()), 'super_admin')
  );
