-- supabase/tests/0620_g1_handoff_readers_on_posts.sql | 0620 (G1 step 6a-2, ADR-006, D-214): the
-- handoff readers read `post_handoffs` / `posts` instead of `giving_handoffs` / `listings`, with the
-- same results. Each reader is compared with its previous body (kept below as pg_temp.old_*, run on
-- the derived giving_handoffs rows) over real flows:
--   1. items: a reservation, its confirmation and hand-over, and the rating — get_listing_handoff
--      (by listing id and by post id), list_my_giving_handoffs, listing_has_active_handoff;
--   2. rides: a waiting and a confirmed seat booking — list_ride_bookings (by either id),
--      ride_listing_participants, find_ride_listing_matches (seats left), the passenger's readers;
--   3. housing: an approved and a waiting stay — list_housing_bookings, list_my_housing_stays,
--      housing_guests_on_night, housing_guest_has_overlap, can_view_housing_private_details and
--      the housing_booking_details RLS policy (under the authenticated role);
--   4. time: an event registration lives on post_handoffs only; the generic readers keep skipping
--      it (events have their own roster and registration RPCs).
-- STABLE helpers (post_id_of_listing) are read in a statement after the one that creates the row.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('hr_giver')             as giver,
       kc_test.create_user('hr_taker')             as taker,
       kc_test.create_user('hr_driver')            as driver,
       kc_test.create_user('hr_rider_a')           as rider_a,
       kc_test.create_user('hr_rider_b')           as rider_b,
       kc_test.create_housing_member('hr_host')    as host,
       kc_test.create_housing_member('hr_guest')   as guest,
       kc_test.create_housing_member('hr_guest2')  as guest2,
       kc_test.create_user('hr_organizer')         as organizer,
       kc_test.create_user('hr_attendee')          as attendee,
       kc_test.create_user('hr_stranger')          as stranger,
       gen_random_uuid()                           as org_id;

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** p_new and p_old return the same rows (as multisets), p_rows of them. */
create function pg_temp.assert_same_rows(p_new text, p_old text, p_rows bigint, p_message text)
returns void
language plpgsql
as $$
begin
  perform kc_test.assert_row_count(p_new, p_rows, p_message || ': row count');
  perform kc_test.assert_row_count(format('(%s) except all (%s)', p_new, p_old), 0,
    p_message || ': no row only on the post side');
  perform kc_test.assert_row_count(format('(%s) except all (%s)', p_old, p_new), 0,
    p_message || ': no row only on the listing side');
end $$;

/** An open item offer by p_owner through the app's RPC; returns its listing id. */
create function pg_temp.item_offer(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => p_title,
    p_details => '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    p_city_id => 'tel-aviv');
end $$;

/** Publishes an automatic-registration event as p_owner for p_org (as the create form does). */
create function pg_temp.publish_event(p_owner uuid, p_org uuid)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'park cleanup',
    p_details => jsonb_build_object(
      'org_id', p_org::text, 'registration_policy', 'automatic', 'capacity', 10,
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 3 hours'),
      'address', 'Central park'),
    p_city_id => 'tel-aviv');
end $$;

-- ── the previous bodies, on the derived giving_handoffs rows (0556, 0385, 0603) ───────────────

/** get_listing_handoff as of 0556. */
create function pg_temp.old_listing_handoff(p_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'handoff_id', h.handoff_id, 'listing_id', h.listing_id,
    'post_id', public.post_id_of_listing(h.listing_id),
    'owner_id', h.owner_id, 'recipient_id', h.recipient_id, 'world_slug', h.world_slug,
    'status', h.status, 'pickup_mode', h.pickup_mode,
    'pickup_window_start', h.pickup_window_start, 'pickup_window_end', h.pickup_window_end,
    'confirm_by', h.confirm_by, 'reserved_at', h.reserved_at, 'confirmed_at', h.confirmed_at,
    'seats', h.seats, 'slot_starts_at', h.slot_starts_at, 'slot_ends_at', h.slot_ends_at)
    from public.giving_handoffs h
   where h.listing_id = public.handoff_target_listing_id(p_id)
     and (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     and (h.status in ('reserved', 'confirmed')
          or (h.status = 'handed_over'
              and not exists (select 1 from public.giving_handoff_ratings r
                               where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())))
   order by (h.status in ('reserved', 'confirmed')) desc, h.reserved_at desc
   limit 1;
$$;

/** list_my_giving_handoffs as of 0385 (without the limit). */
create function pg_temp.old_my_handoffs()
returns table (handoff_id uuid, listing_id uuid, title text, world_slug text, status text, role text,
               pickup_window_start timestamptz, pickup_window_end timestamptz, reserved_at timestamptz)
language sql
as $$
  select h.handoff_id, h.listing_id, l.title, h.world_slug, h.status,
         case when h.owner_id = auth.uid() then 'owner' else 'recipient' end,
         h.pickup_window_start, h.pickup_window_end, h.reserved_at
    from public.giving_handoffs h
    join public.listings l on l.listing_id = h.listing_id
   where (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     and h.status <> 'cancelled';
$$;

/** list_ride_bookings as of 0556 (rows only; the owner check is asserted separately). */
create function pg_temp.old_ride_bookings(p_id uuid)
returns table (handoff_id uuid, recipient_id uuid, passenger_name text, avatar_url text, seats int,
               status text, reserved_at timestamptz, confirm_by timestamptz, rated_by_me boolean)
language sql
as $$
  select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
         h.reserved_at, h.confirm_by,
         exists (select 1 from public.giving_handoff_ratings r
                  where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
    from public.giving_handoffs h
    join public.users u on u.user_id = h.recipient_id
   where h.listing_id = public.handoff_target_listing_id(p_id)
     and h.status in ('reserved', 'confirmed', 'handed_over');
$$;

/** list_housing_bookings as of 0603 (rows only). */
create function pg_temp.old_housing_bookings(p_listing_id uuid)
returns table (handoff_id uuid, recipient_id uuid, guest_name text, avatar_url text,
               guest_verified boolean, guest_completed_stays bigint, guest_member_since timestamptz,
               check_in_date date, check_out_date date, slot_starts_at timestamptz,
               slot_ends_at timestamptz, adults smallint, minors smallint, message text, status text,
               reserved_at timestamptz, confirm_by timestamptz, rated_by_me boolean)
language sql
as $$
  select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, u.verified_at is not null,
         (select count(*) from public.giving_handoffs g
           where g.recipient_id = h.recipient_id and g.world_slug = 'housing' and g.status = 'handed_over'),
         u.created_at, d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at,
         d.adults, d.minors, d.message, h.status, h.reserved_at, h.confirm_by,
         exists (select 1 from public.giving_handoff_ratings r
                  where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
    from public.giving_handoffs h
    join public.housing_booking_details d on d.handoff_id = h.handoff_id
    join public.users u on u.user_id = h.recipient_id
   where h.listing_id = p_listing_id
     and h.status in ('reserved', 'confirmed', 'handed_over');
$$;

/** list_my_housing_stays as of 0603, every column but city_id (asserted separately). */
create function pg_temp.old_my_stays()
returns table (handoff_id uuid, listing_id uuid, listing_title text, host_id uuid, host_name text,
               check_in_date date, check_out_date date, slot_starts_at timestamptz,
               slot_ends_at timestamptz, adults smallint, minors smallint, status text,
               cancel_reason text, reserved_at timestamptz, confirm_by timestamptz,
               can_view_address boolean, rated_by_me boolean)
language sql
as $$
  select h.handoff_id, h.listing_id, l.title, h.owner_id, u.display_name,
         d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at, d.adults, d.minors,
         h.status, h.cancel_reason, h.reserved_at, h.confirm_by,
         public.can_view_housing_private_details(h.listing_id, auth.uid()),
         exists (select 1 from public.giving_handoff_ratings r
                  where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
    from public.giving_handoffs h
    join public.housing_booking_details d on d.handoff_id = h.handoff_id
    join public.listings l on l.listing_id = h.listing_id
    join public.users u on u.user_id = h.owner_id
   where h.recipient_id = auth.uid() and h.world_slug = 'housing';
$$;

-- 0520: pg_temp helpers are owner-only by default; grant them so any caller may run them.
grant execute on function pg_temp.assert_same_rows(text, text, bigint, text) to public;
grant execute on function pg_temp.item_offer(uuid, text) to public;
grant execute on function pg_temp.publish_event(uuid, uuid) to public;
grant execute on function pg_temp.old_listing_handoff(uuid) to public;
grant execute on function pg_temp.old_my_handoffs() to public;
grant execute on function pg_temp.old_ride_bookings(uuid) to public;
grant execute on function pg_temp.old_housing_bookings(uuid) to public;
grant execute on function pg_temp.old_my_stays() to public;

-- The new list as the old one sees it (no limit is reached in these fixtures).
create function pg_temp.new_my_handoffs_sql()
returns text
language sql
immutable
as $$ select 'select * from public.list_my_giving_handoffs(100)' $$;
grant execute on function pg_temp.new_my_handoffs_sql() to public;

-- ── 1. items: reserve, confirm, hand over, rate ───────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a reading lamp');
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the item offer has its post');

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_listing, 'pickup', null, null);

  -- get_listing_handoff: the same payload by listing id and by post id, for both sides.
  perform kc_test.assert_eq(public.get_listing_handoff(v_listing), pg_temp.old_listing_handoff(v_listing),
    'items: the taker''s reservation by listing id is the same payload');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post), pg_temp.old_listing_handoff(v_post),
    'items: and by post id');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'handoff_id', h.handoff_id::text,
    'items: it is the reservation');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'listing_id', v_listing::text,
    'items: the payload keeps the listing id for the app');
  perform kc_test.assert_eq(public.get_listing_handoff(v_listing) ->> 'post_id', v_post::text,
    'items: and carries the post id');
  perform pg_temp.assert_same_rows(pg_temp.new_my_handoffs_sql(), 'select * from pg_temp.old_my_handoffs()', 1,
    'items: the taker''s handoffs');
  perform kc_test.assert_row_count(
    format('select 1 from public.list_my_giving_handoffs() where handoff_id = %L and title = %L and role = ''recipient''',
           h.handoff_id, 'a reading lamp'), 1, 'items: titled by the post, the taker as recipient');

  perform kc_test.act_as(p.giver);
  perform kc_test.assert_eq(public.get_listing_handoff(v_listing), pg_temp.old_listing_handoff(v_listing),
    'items: the giver sees the same reservation');
  perform pg_temp.assert_same_rows(pg_temp.new_my_handoffs_sql(), 'select * from pg_temp.old_my_handoffs()', 1,
    'items: the giver''s handoffs');

  -- listing_has_active_handoff guards the owner RPCs while the reservation is live.
  perform kc_test.assert_true(public.listing_has_active_handoff(v_listing), 'items: a reservation is an active handoff');
  h := public.confirm_item_handoff(h.handoff_id);
  perform kc_test.assert_true(public.listing_has_active_handoff(v_listing), 'items: so is a confirmed one');
  h := public.mark_giving_handed_over(h.handoff_id);
  perform kc_test.assert_true(not public.listing_has_active_handoff(v_listing), 'items: a handed-over one is not');

  -- Handed over and not rated yet: offered for rating, then gone once rated.
  perform kc_test.act_as(p.taker);
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'status', 'handed_over',
    'items: the handed-over handoff is offered for rating');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post), pg_temp.old_listing_handoff(v_post),
    'items: the same payload after the hand-over');
  perform public.rate_giving_handoff(h.handoff_id, 5::smallint, 'thanks');
  perform kc_test.assert_true(public.get_listing_handoff(v_post) is null, 'items: a rated handoff is not offered again');
  perform kc_test.assert_true(pg_temp.old_listing_handoff(v_post) is null, 'items: as before');
  perform pg_temp.assert_same_rows(pg_temp.new_my_handoffs_sql(), 'select * from pg_temp.old_my_handoffs()', 1,
    'items: the taker''s handoffs after the hand-over');
end $$;

-- ── 2. rides: a waiting and a confirmed seat booking ──────────────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_post uuid;
  h_a uuid;
  h_b uuid;
  c_ride_cols constant text := 'handoff_id, recipient_id, passenger_name, avatar_url, seats, status,
    reserved_at, confirm_by, rated_by_me';
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 4);
  v_post := public.post_id_of_listing(v_ride);
  perform kc_test.assert_true(v_post is not null, 'the ride offer has its post');

  h_a := kc_test.book_ride(p.rider_a, v_ride, 1);
  h_b := kc_test.book_ride(p.rider_b, v_post, 2);
  perform kc_test.act_as(p.driver);
  perform public.confirm_ride_booking(h_b);

  -- list_ride_bookings: the driver's rows, by listing id and by post id.
  -- The columns added later (requested_stop_label 0649, cancel_reason 0655) are not part of the old payload.
  perform pg_temp.assert_same_rows(format('select %s from public.list_ride_bookings(%L)', c_ride_cols, v_ride),
    format('select * from pg_temp.old_ride_bookings(%L)', v_ride), 2, 'rides: the bookings by listing id');
  perform pg_temp.assert_same_rows(format('select %s from public.list_ride_bookings(%L)', c_ride_cols, v_post),
    format('select * from pg_temp.old_ride_bookings(%L)', v_ride), 2, 'rides: and by post id');
  perform kc_test.assert_eq((select b.seats from public.list_ride_bookings(v_post) b where b.handoff_id = h_b), 2,
    'rides: the confirmed booking holds two seats');
  perform kc_test.act_as(p.rider_a);
  perform kc_test.assert_raises(format('select * from public.list_ride_bookings(%L)', v_ride),
    'owner_only', 'rides: a passenger does not list the bookings');
  perform kc_test.assert_raises(format('select * from public.list_ride_bookings(%L)', gen_random_uuid()),
    'owner_only', 'rides: nor does anyone for an unknown id');

  -- ride_listing_participants: the driver and the confirmed passenger, not the waiting one.
  perform pg_temp.assert_same_rows(format('select * from public.ride_listing_participants(%L)', v_ride),
    format($q$select owner_id from public.listings where listing_id = %1$L
              union select recipient_id from public.giving_handoffs
               where listing_id = %1$L and world_slug = 'rides' and status in ('confirmed', 'handed_over')$q$, v_ride),
    2, 'rides: the participants');
  perform kc_test.assert_row_count(
    format('select 1 from public.ride_listing_participants(%L) u where u = %L', v_ride, p.rider_a), 0,
    'rides: a waiting passenger is not a participant');

  -- find_ride_listing_matches: 4 seats, 1 waiting + 2 confirmed taken, 1 left.
  perform kc_test.assert_row_count(
    format('select 1 from public.find_ride_listing_matches(32.07, 34.79, 31.78, 35.20)
             where listing_id = %L and seats_left = 1', v_ride),
    1, 'rides: the corridor match counts the seats taken on the record');

  -- The passenger's own readers.
  perform kc_test.act_as(p.rider_b);
  perform kc_test.assert_eq(public.get_listing_handoff(v_ride), pg_temp.old_listing_handoff(v_ride),
    'rides: the passenger''s booking is the same payload');
  perform kc_test.assert_eq(public.get_listing_handoff(v_post) ->> 'seats', '2', 'rides: with its seats');
  perform pg_temp.assert_same_rows(pg_temp.new_my_handoffs_sql(), 'select * from pg_temp.old_my_handoffs()', 1,
    'rides: the passenger''s handoffs');
  perform kc_test.act_as(p.driver);
  perform pg_temp.assert_same_rows(pg_temp.new_my_handoffs_sql(), 'select * from pg_temp.old_my_handoffs()', 2,
    'rides: the driver''s handoffs');
end $$;

-- ── 3. housing: an approved and a waiting stay on one offer ───────────────────────────────────
do $$
declare
  p personas;
  v_offer uuid;
  v_post uuid;
  v_day date := public.housing_today();
  h1 uuid;
  h2 uuid;
  v_n bigint;
begin
  select * into p from personas;
  v_offer := kc_test.create_housing_offer(p.host);
  v_post := public.post_id_of_listing(v_offer);
  perform kc_test.assert_true(v_post is not null, 'the stay offer has its post');

  h1 := kc_test.request_stay(p.guest, v_offer, 3, 2);   -- nights day+3, day+4
  perform kc_test.approve_stay(p.host, h1);
  h2 := kc_test.request_stay(p.guest2, v_offer, 3, 1);  -- night day+3, waiting

  -- Night capacity and overlap (the approval and the second request already ran through them).
  perform kc_test.assert_eq(public.housing_guests_on_night(v_offer, v_day + 3, null), 1,
    'housing: one confirmed guest on the first night');
  perform kc_test.assert_eq(public.housing_guests_on_night(v_offer, v_day + 4, null), 1,
    'housing: and on the second');
  perform kc_test.assert_eq(public.housing_guests_on_night(v_offer, v_day + 5, null), 0,
    'housing: none on the check-out night');
  perform kc_test.assert_eq(public.housing_guests_on_night(v_offer, v_day + 3, h1), 0,
    'housing: none when the confirmed stay is excluded (a waiting request does not count)');
  perform kc_test.assert_true(public.housing_guest_has_overlap(p.guest, v_day + 4, v_day + 6, null),
    'housing: the guest''s confirmed stay overlaps a stay that shares a night');
  perform kc_test.assert_true(not public.housing_guest_has_overlap(p.guest, v_day + 5, v_day + 7, null),
    'housing: but not one starting on its check-out day');
  perform kc_test.assert_true(not public.housing_guest_has_overlap(p.guest, v_day + 4, v_day + 6, h1),
    'housing: nor when the stay itself is excluded');
  perform kc_test.assert_true(not public.housing_guest_has_overlap(p.guest2, v_day + 3, v_day + 4, null),
    'housing: a waiting request is not a stay');

  -- Who may read the exact place.
  perform kc_test.assert_true(public.can_view_housing_private_details(v_offer, p.host), 'housing: the host');
  perform kc_test.assert_true(public.can_view_housing_private_details(v_offer, p.guest), 'housing: the confirmed guest');
  perform kc_test.assert_true(not public.can_view_housing_private_details(v_offer, p.guest2),
    'housing: not the waiting guest');
  perform kc_test.assert_true(not public.can_view_housing_private_details(v_offer, p.stranger), 'housing: not a stranger');
  perform kc_test.assert_true(not public.can_view_housing_private_details(v_offer, null), 'housing: not nobody');

  -- The host's list and the guests' lists.
  perform kc_test.act_as(p.host);
  perform pg_temp.assert_same_rows(format('select * from public.list_housing_bookings(%L)', v_offer),
    format('select * from pg_temp.old_housing_bookings(%L)', v_offer), 2, 'housing: the host''s bookings');
  perform kc_test.act_as(p.guest);
  perform kc_test.assert_raises(format('select * from public.list_housing_bookings(%L)', v_offer),
    'owner_only', 'housing: a guest does not list the offer''s bookings');

  perform pg_temp.assert_same_rows(
    $q$select handoff_id, listing_id, listing_title, host_id, host_name, check_in_date, check_out_date,
              slot_starts_at, slot_ends_at, adults, minors, status, cancel_reason, reserved_at, confirm_by,
              can_view_address, rated_by_me
         from public.list_my_housing_stays()$q$,
    'select * from pg_temp.old_my_stays()', 1, 'housing: the confirmed guest''s stays');
  perform kc_test.assert_eq((select s.city_id from public.list_my_housing_stays() s where s.handoff_id = h1),
    (select city from public.posts where post_id = v_post), 'housing: the stay names the offer post''s city');
  perform kc_test.assert_true((select s.can_view_address from public.list_my_housing_stays() s where s.handoff_id = h1),
    'housing: the confirmed guest may open the address');
  perform kc_test.act_as(p.guest2);
  perform kc_test.assert_true(not (select s.can_view_address from public.list_my_housing_stays() s where s.handoff_id = h2),
    'housing: the waiting guest may not');

  -- RLS on housing_booking_details: each side reads the details of its own bookings only.
  perform kc_test.act_as(p.guest);
  set local role authenticated;
  select count(*) into v_n from public.housing_booking_details where handoff_id in (h1, h2);
  reset role;
  perform kc_test.assert_eq(v_n, 1::bigint, 'housing RLS: the guest reads the details of their own booking only');

  perform kc_test.act_as(p.host);
  set local role authenticated;
  select count(*) into v_n from public.housing_booking_details where handoff_id in (h1, h2);
  reset role;
  perform kc_test.assert_eq(v_n, 2::bigint, 'housing RLS: the host reads both bookings on the offer');

  perform kc_test.act_as(p.stranger);
  set local role authenticated;
  select count(*) into v_n from public.housing_booking_details where handoff_id in (h1, h2);
  reset role;
  perform kc_test.assert_eq(v_n, 0::bigint, 'housing RLS: a stranger reads none');
end $$;

-- ── 4. time: an event registration lives on post_handoffs only; generic readers skip it ───────
insert into public.organizations (org_id, name, slug)
select org_id, 'Handoff readers org', 'handoff-readers-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_volunteer' from personas;

do $$
declare
  p personas;
  v_event uuid;
  v_post uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  v_event := pg_temp.publish_event(p.organizer, p.org_id);
  v_post := public.post_id_of_listing(v_event);
  perform kc_test.assert_true(v_post is not null, 'the event has its post');

  perform kc_test.act_as(p.attendee);
  v_reg := public.register_for_event(v_post);
  perform kc_test.assert_eq(v_reg.status, 'confirmed', 'time: an automatic registration is confirmed');
  perform kc_test.assert_row_count(
    format('select 1 from public.post_handoffs where handoff_id = %L and world_slug = ''time''', v_reg.handoff_id), 1,
    'time: the registration is on the record');

  perform kc_test.assert_true(public.get_listing_handoff(v_post) is null,
    'time: the attendee''s registration is not a giving handoff (by post id)');
  perform kc_test.assert_true(public.get_listing_handoff(v_event) is null, 'time: nor by listing id');
  perform kc_test.assert_row_count(
    format('select 1 from public.list_my_giving_handoffs() where handoff_id = %L', v_reg.handoff_id), 0,
    'time: the registration is not listed among the attendee''s handoffs');

  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_true(public.get_listing_handoff(v_post) is null, 'time: nor for the organizer');
  perform kc_test.assert_row_count('select 1 from public.list_my_giving_handoffs()', 0,
    'time: the organizer has no giving handoffs');
  perform kc_test.assert_true(not public.listing_has_active_handoff(v_event),
    'time: a registration does not block the owner RPCs, as before');
end $$;

rollback;

\echo '✓ 0620_g1_handoff_readers_on_posts passed'
