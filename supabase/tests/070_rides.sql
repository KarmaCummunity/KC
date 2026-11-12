-- Rides: a ride is created with its details in one call and never exists without them;
-- places are official, the cost share is capped, a driver declares once; seats never
-- overbook; each booking RPC accepts and refuses what the spec says, inside its time
-- window; saved routes alert once; recurring rides materialise; the feed, the emergency
-- call and the expiry sweep behave; a ride leaves with its post and its owner.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @a … @e members, #name the post titled `name`, ~name.x the
-- booking of member x on that post (a live one first). Posts and bookings are resolved
-- here, as the database owner, so a statement can name a row its caller cannot read.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~(\w+)\.([a-e])', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || '.' || v_match[2], coalesce(quote_literal((
      select h.id from public.post_handoffs h join public.posts p on p.id = h.post_id
       where p.title = v_match[1] and h.recipient_id = ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid
       order by (h.status = 'cancelled'), h.ctid desc limit 1)), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(v_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a member (anon when null): 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as a member, or as the database owner when p_who is null.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  if p_who is not null then
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- Notification events of a kind addressed to a member.
create function pg_temp.told(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

-- Creates a ride as a member: c1 → p_dest, leaving after p_in, with extra detail fields.
create function pg_temp.ride(
  p_who text, p_title text, p_in interval, p_seats integer, p_extra jsonb default '{}',
  p_direction text default 'offer', p_dest text default 'c2')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.create_post_with_details(%L::jsonb, %L::jsonb)',
    jsonb_build_object('world_slug', 'rides', 'post_type', 'ride', 'direction', p_direction, 'title', p_title,
      'city_id', 'c1', 'kind_id', (select k.id from public.post_kinds k where k.slug = 'ride_' || p_direction)),
    jsonb_build_object('origin_city_id', 'c1', 'dest_city_id', p_dest, 'departs_at', now() + p_in,
      'seats', p_seats) || p_extra));
$$;

select plan(113);

-- Alice drives. Bob, Carol and Eve ride. Dan and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(34.99 32.79)'),
  ('c3', 'c3', 'City Three', 'SRID=4326;POINT(34.95 29.56)');
insert into public.streets (city_id, street_id, name_he) values ('c1', 1, 's1');
insert into public.road_junctions (junction_id, kind, name_he, location)
select n, 'junction', 'j' || n, format('SRID=4326;POINT(35.0 %s)', 32.7 + n * 0.01)::extensions.geography
  from generate_series(1, 12) n;
insert into public.worlds (slug, label_he, label_en) values ('rides', 'rides', 'rides'), ('items', 'items', 'items');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('rides', 'ride_offer', 'o', 'o', 'offer'), ('rides', 'ride_request', 'r', 'r', 'request');

-- ── Creating a ride ─────────────────────────────────────────────────────────
select is(pg_temp.ride('a', 'r0', '1 day', 3), 'declaration_required', 'an offer needs the driver declaration');
select is(pg_temp.act('a', $$select public.accept_world_consent('driver_declaration', 2)$$), 'consent_version_stale',
  'only the version in force is accepted');
select is(pg_temp.act('a', $$select public.accept_world_consent('pilot_licence', 1)$$), 'unknown_consent_kind',
  'an unknown consent kind is refused');
select is(pg_temp.act('a', $$select public.accept_world_consent('driver_declaration', 1)$$), 'ok', 'the driver declares');
select is(pg_temp.act('c', $$select public.accept_world_consent('driver_declaration', 1)$$), 'ok', 'so does Carol');
select is(pg_temp.ride('a', 'r1', '1 day', 3,
    '{"origin_street_id":1,"meeting_points":[{"junction_id":3}],"reward_model":"expense_share","cost_share_ils":70}'),
  'ok', 'a ride is created and published in one call');
select is(pg_temp.val(null, $$select status || '|' || (expires_at = now() + interval '1 day 30 minutes')
    || '|' || (lower(time_window) = now() + interval '1 day') from public.posts where title = 'r1'$$),
  'open|true|true', 'an offer expires 30 minutes after departure and carries its time window');
select is(pg_temp.val(null, $$select (origin_point is not null) || '|' || (meeting_points -> 0 ->> 'lat')
    from public.post_ride_details where post_id = #r1$$), 'true|32.73', 'positions are written from the catalogs');
select is(pg_temp.ride('a', 'bad', '1 day', 3, '{"dest_city_id":"nowhere"}'), 'ride_place_invalid', 'an unknown city is refused');
select is(pg_temp.ride('a', 'bad', '1 day', 3, '{"dest_junction_id":5}'), 'ride_place_invalid', 'a place is one shape only');
select is(pg_temp.ride('a', 'bad', '1 day', 3, '{"meeting_points":[{"city_id":"zz"}]}'), 'ride_place_invalid',
  'a meeting point must be an official place');
select is(pg_temp.ride('a', 'bad', '1 day', 3, '{"reward_model":"expense_share","cost_share_ils":71}'),
  'ride_cost_share_cap_exceeded', 'between cities the share is capped at 70');
select is(pg_temp.ride('a', 'bad', '1 day', 3, '{"reward_model":"expense_share","cost_share_ils":21}', 'offer', 'c1'),
  'ride_cost_share_cap_exceeded', 'inside one city it is capped at 20');
select is(pg_temp.ride('a', 'bad', '-1 hour', 3), 'ride_time_invalid', 'a ride cannot leave in the past');
select is(pg_temp.ride('a', 'bad', '1 day', 9), '23514', 'at most eight seats');
select is(pg_temp.ride(null, 'bad', '1 day', 3), '42501', 'a signed-out caller cannot create a ride');
select is(pg_temp.act('a', $$select public.create_post_with_details(
    jsonb_build_object('world_slug', 'items', 'direction', 'offer', 'title', 'x', 'city_id', 'c1',
      'kind_id', (select id from public.post_kinds limit 1)), '{}')$$),
  '23503', 'the kind must belong to the world');
select is(pg_temp.act('a', $$insert into public.posts (owner_id, world_slug, kind_id, post_type, direction, title, city_id)
    select @a, 'rides', id, 'ride', 'offer', 'bare', 'c1' from public.post_kinds where slug = 'ride_offer';
    set constraints all immediate$$), 'post_details_required', 'a ride post cannot exist without its details');
select is(pg_temp.ride('b', 'rq1', '1 day', 2, '{}', 'request'), 'ok', 'a request needs no declaration');
select is(pg_temp.val(null, $$select expires_at is null from public.posts where title = 'rq1'$$), 'true',
  'a one-off request never expires');

-- ── Access ──────────────────────────────────────────────────────────────────
select is(pg_temp.val('b', $$select count(*) from public.post_ride_details where post_id = #r1$$), '1',
  'a member reads the details of a ride they can see');
select is(pg_temp.val('d', $$select count(*) from public.post_ride_details$$), '1',
  'a blocked member sees none of the driver''s rides');
select is(pg_temp.act(null, $$select 1 from public.post_ride_details$$), '42501', 'signed-out callers read nothing');
select is(pg_temp.act('a', $$update public.post_ride_details set notes = 'blue car' where post_id = #r1$$), 'ok',
  'the owner edits the ride');
select is(pg_temp.act('b', $$update public.post_ride_details set notes = 'mine' where post_id = #r1$$)
    || '|' || pg_temp.val(null, $$select notes from public.post_ride_details where post_id = #r1$$),
  'ok|blue car', 'another member''s edit changes nothing');
select is(pg_temp.act('a', $$update public.post_ride_details set series_on = current_date where post_id = #r1$$),
  '42501', 'derived and server-owned columns are not writable');
select is(pg_temp.act('a', $$delete from public.post_ride_details where post_id = #r1$$), '42501',
  'the details leave only with the post');

-- ── Booking: seats, approval, cancel, reinstate ─────────────────────────────
select is(pg_temp.act('b', $$select public.book_ride_seat(#r1, 2)$$), 'ok', 'a passenger books two seats');
select is(pg_temp.val(null, $$select status || '|' || seats || '|' || (confirm_by = now() + interval '12 hours')
    from public.post_handoffs where id = ~r1.b$$), 'reserved|2|true', 'the booking waits, for at most 12 hours');
select is(pg_temp.act('a', $$select public.book_ride_seat(#r1)$$), 'own_listing', 'the driver cannot book');
select is(pg_temp.act('d', $$select public.book_ride_seat(#r1)$$), 'listing_not_available', 'a blocked member cannot book');
select is(pg_temp.act('b', $$select public.book_ride_seat(#r1)$$), 'item_already_reserved', 'one live booking per member');
select is(pg_temp.act('c', $$select public.book_ride_seat(#r1, 2)$$), 'seats_exhausted', 'waiting bookings hold their seats');
select is(pg_temp.act('c', $$select public.book_ride_seat(#r1, 1, '{"kind":"city"}')$$), 'ride_place_invalid',
  'a requested meeting point names a place');
select is(pg_temp.act('c', $$select public.book_ride_seat(#r1, 1, '{"kind":"junction","id":"3","label":"j3"}')$$),
  'ok', 'the last seat is booked');
select is(pg_temp.act('c', $$select public.book_ride_seat(#rq1)$$), 'not_ride_offer', 'a request is not booked');
select is(pg_temp.act('c', $$select public.book_ride_seat(gen_random_uuid())$$), 'listing_not_available',
  'an unknown ride is not available');
select is(pg_temp.told('ride_booking_requested', 'a'), 2::bigint, 'the driver is told about each booking');
select is(pg_temp.act('b', $$select public.confirm_ride_booking(~r1.b)$$), 'handoff_not_found', 'only the driver approves');
select is(pg_temp.act('a', $$select public.confirm_ride_booking(~r1.b)$$), 'ok', 'the driver approves');
select is(pg_temp.act('a', $$select public.confirm_ride_booking(~r1.b)$$), 'invalid_status', 'an approval is given once');
select is(pg_temp.told('ride_booking_confirmed', 'b'), 1::bigint, 'the passenger is told');
select is(pg_temp.act('a', $$update public.post_ride_details set seats = 2 where post_id = #r1$$),
  'ride_seats_below_bookings', 'seats cannot drop below the bookings');
select is(pg_temp.act('e', $$select public.cancel_ride_booking(~r1.c)$$), 'handoff_not_found', 'a stranger cannot cancel');
select is(pg_temp.act('c', $$select public.cancel_ride_booking(~r1.c)$$), 'ok', 'the passenger cancels');
select is(pg_temp.act('a', $$select public.reinstate_ride_booking(~r1.c)$$), 'invalid_status',
  'a booking the passenger cancelled is not reinstated');
select is(pg_temp.act('c', $$select public.book_ride_seat(#r1)$$), 'ok', 'the passenger books again');
select is(pg_temp.act('a', $$select public.cancel_ride_booking(~r1.c)$$)
    || '|' || pg_temp.val(null, $$select cancel_reason from public.post_handoffs where id = ~r1.c$$),
  'ok|declined', 'a driver cancelling a waiting booking declines it');
select is(pg_temp.act('c', $$select public.reinstate_ride_booking(~r1.c)$$), 'handoff_not_found', 'only the driver reinstates');
select is(pg_temp.act('a', $$select public.reinstate_ride_booking(~r1.c)$$)
    || '|' || pg_temp.val(null, $$select status || '|' || (confirm_by is not null) from public.post_handoffs where id = ~r1.c$$),
  'ok|reserved|true', 'a declined booking waits again with a fresh deadline');
select is(pg_temp.act('a', $$select public.cancel_ride_booking(~r1.b)$$)
    || '|' || pg_temp.val(null, $$select cancel_reason from public.post_handoffs where id = ~r1.b$$),
  'ok|driver_cancelled', 'the driver withdraws an approval');
select is(pg_temp.act('e', $$select public.book_ride_seat(#r1, 2)$$), 'ok', 'the freed seats are taken');
select is(pg_temp.act('a', $$select public.reinstate_ride_booking(~r1.b)$$), 'ride_seats_exhausted',
  'a reinstatement needs free seats');
select is(pg_temp.act('e', $$select public.cancel_ride_booking(~r1.e)$$), 'ok', 'Eve leaves');
select is(pg_temp.act('a', $$select public.reinstate_ride_booking(~r1.b)$$)
    || '|' || pg_temp.val(null, $$select status from public.post_handoffs where id = ~r1.b$$),
  'ok|confirmed', 'a withdrawn approval is restored as approved');

-- ── Completing: only from one hour before departure ─────────────────────────
select is(pg_temp.act('b', $$select public.complete_ride_trip(~r1.b)$$), 'ride_not_started', 'a trip a day away is not completed');
select is(pg_temp.act('a', $$select public.complete_ride(#r1)$$), 'ride_not_started', 'nor the whole ride');
select is(pg_temp.ride('a', 'r2', '30 minutes', 2), 'ok', 'a ride leaving soon');
select is(pg_temp.act('b', $$select public.book_ride_seat(#r2)$$) || pg_temp.act('c', $$select public.book_ride_seat(#r2)$$)
    || pg_temp.act('a', $$select public.confirm_ride_booking(~r2.b)$$), 'okokok', 'two bookings, one approved');
select is(pg_temp.act('c', $$select public.complete_ride_trip(~r2.c)$$), 'invalid_status',
  'a passenger cannot complete a booking that was not approved');
select is(pg_temp.act('b', $$select public.complete_ride_trip(~r2.b)$$), 'ok', 'the passenger completes an approved booking');
select is(pg_temp.val(null, $$select status from public.posts where title = 'r2'$$), 'open', 'the ride stays open while a booking is live');
select is(pg_temp.act('a', $$select public.complete_ride_trip(~r2.c)$$), 'ok', 'the driver completes a booking still waiting');
select is(pg_temp.val(null, $$select status from public.posts where title = 'r2'$$), 'closed_delivered',
  'a full ride with nothing left open closes as delivered');
select is(pg_temp.ride('a', 'r3', '30 minutes', 3), 'ok', 'another ride leaving soon');
select is(pg_temp.act('b', $$select public.book_ride_seat(#r3)$$) || pg_temp.act('c', $$select public.book_ride_seat(#r3)$$)
    || pg_temp.act('a', $$select public.confirm_ride_booking(~r3.b)$$), 'okokok', 'two bookings, one approved');
select is(pg_temp.act('b', $$select public.complete_ride(#r3)$$), 'post_not_found', 'only the driver completes the ride');
select is(pg_temp.val('a', $$select public.complete_ride(#r3)$$), '1', 'the driver completes the ride: one booking travelled');
select is(pg_temp.val(null, $$select p.status || '|' || (select string_agg(h.status || ':' || coalesce(h.cancel_reason, '-'), ' ' order by h.recipient_id)
    from public.post_handoffs h where h.post_id = p.id) from public.posts p where p.title = 'r3'$$),
  'closed_delivered|handed_over:- cancelled:superseded', 'the offer closes and the waiting booking ends with it');
select is(pg_temp.act('a', $$select public.complete_ride(#r3)$$), 'invalid_status', 'a ride is completed once');

-- ── Emergency call ──────────────────────────────────────────────────────────
select is(pg_temp.ride('a', 'r4', '30 minutes', 3), 'ok', 'a ride under way soon');
select is(pg_temp.act('b', $$select public.book_ride_seat(#r4)$$) || pg_temp.act('a', $$select public.confirm_ride_booking(~r4.b)$$)
    || pg_temp.act('c', $$select public.book_ride_seat(#r4)$$), 'okokok', 'Bob is approved, Carol waits');
select is(pg_temp.act('c', $$select public.report_post_emergency(#r4)$$), 'emergency_not_active',
  'a passenger who was not approved cannot call');
select is(pg_temp.act('a', $$select public.report_post_emergency(#r1)$$), 'emergency_not_active',
  'no call outside the ride''s active window');
select is(pg_temp.act('b', $$select public.report_post_emergency(#r4, 'help', 32.1, 34.8)$$), 'ok', 'an approved passenger calls for help');
select is(pg_temp.act('b', $$select public.report_post_emergency(#r4)$$), 'emergency_throttled', 'once per five minutes');
select is(pg_temp.told('post_emergency', 'a') || '|' || pg_temp.told('post_emergency', 'c')
    || '|' || (select count(*) from kc_private.outbox_events e where e.topic = 'moderation' and e.payload ->> 'kind' = 'post_emergency'),
  '1|0|1', 'the other participant and the safety team are alerted');
select is(pg_temp.val('a', $$select count(*) from public.post_emergencies$$) || pg_temp.val('b', $$select count(*) from public.post_emergencies$$)
    || pg_temp.val('c', $$select count(*) from public.post_emergencies$$), '110', 'the caller and the driver see the call');
select is(pg_temp.act('a', $$select note from public.post_emergencies$$), '42501', 'its note is not readable');
select is(pg_temp.act('a', $$insert into public.post_private_locations (post_id, street, street_number, destination_street_number)
    values (#r4, 's1', '7', '12')$$) || pg_temp.val('b', $$select (public.get_post_private_location(#r4)).destination_street_number$$)
    || pg_temp.act('c', $$select public.get_post_private_location(#r4)$$), 'ok12post_not_found',
  'private house numbers of both ends reach the approved passenger only');
alter table public.post_ride_details disable trigger post_ride_details_prepare;
update public.post_ride_details set departs_at = now() - interval '1 minute'
 where post_id = (select id from public.posts where title = 'r4');
alter table public.post_ride_details enable trigger post_ride_details_prepare;
select is(pg_temp.act('e', $$select public.book_ride_seat(#r4)$$), 'ride_departed', 'a departed ride is not booked');
select is(pg_temp.act('a', $$select public.confirm_ride_booking(~r4.c)$$), 'ride_departed', 'nor approved');

-- ── Saved routes and alerts ─────────────────────────────────────────────────
select is(pg_temp.act('e', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id) values ('c1', 'c2')$$), 'ok',
  'a member saves a route');
select is(pg_temp.act('e', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id) values ('c1', 'c2')$$), '23505',
  'the same route is saved once');
select is(pg_temp.act('e', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id) values ('c1', 'zz')$$), 'ride_place_invalid',
  'a route end must be an official place');
select is(pg_temp.act('e', $$insert into public.ride_saved_routes (user_id, origin_city_id, dest_city_id) values (@b, 'c1', 'c3')$$),
  '42501', 'a route cannot be saved for someone else');
select is(pg_temp.act('d', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id) values ('c1', 'c2')$$)
    || pg_temp.act('b', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id, wants) values ('c1', 'c2', 'requests')$$)
    || pg_temp.act('c', $$insert into public.ride_saved_routes (origin_city_id, dest_city_id, weekdays)
         values ('c1', 'c2', 1 << ((extract(dow from now() at time zone 'Asia/Jerusalem')::integer + 3) % 7))$$),
  'okokok', 'more followers: blocked, wanting requests, another weekday');
select is(pg_temp.val('b', $$select count(*) from public.ride_saved_routes$$), '1', 'routes are private');
select is(pg_temp.act('e', $$insert into public.ride_saved_routes (origin_city_id, dest_junction_id)
    select 'c1', n from generate_series(1, 10) n$$), 'saved_routes_limit', 'at most ten routes');
select is(pg_temp.ride('a', 'r5', '1 day', 3, '{}', 'offer', 'c3') || pg_temp.ride('a', 'r6', '1 day', 3), 'okok',
  'two rides are published: one elsewhere, one along the route');
select is((select count(*) from public.ride_route_alerts) || '|' || pg_temp.told('ride_route_match', 'e')
    || '|' || pg_temp.told('ride_route_match', 'd') || pg_temp.told('ride_route_match', 'b') || pg_temp.told('ride_route_match', 'c'),
  '1|1|000', 'only the follower of that route, side and day who can see the ride is alerted');

-- ── Recurring rides ─────────────────────────────────────────────────────────
select is(pg_temp.act('c', format($$select public.create_ride_series(%L::jsonb, '{"origin_city_id":"c1","dest_city_id":"c2","seats":3}',
    '07:30', 0)$$, jsonb_build_object('world_slug', 'rides', 'direction', 'offer', 'title', 'daily', 'city_id', 'c1',
      'kind_id', (select id from public.post_kinds where slug = 'ride_offer')))), 'ride_series_schedule_invalid',
  'a series needs at least one weekday');
select is(pg_temp.act('c', format($$select public.create_ride_series(%L::jsonb, '{"origin_city_id":"c1","dest_city_id":"c2","seats":3}',
    '07:30', 127, 60)$$, jsonb_build_object('world_slug', 'rides', 'direction', 'offer', 'title', 'daily', 'city_id', 'c1',
      'kind_id', (select id from public.post_kinds where slug = 'ride_offer')))), 'ok', 'a daily series is created');
select ok((select count(*) between 30 and 31 and bool_and(p.status = 'open') and bool_and(r.arrives_at = r.departs_at + interval '1 hour')
             from public.post_ride_details r join public.posts p on p.id = r.post_id where r.series_id is not null),
  'its occurrences of the next 30 days are published, beyond the open-post limit');
select is(kc_private.ride_series_materialize(), 0, 'materialising again creates nothing');
select is((select count(*) || '|' || count(distinct user_id) from public.ride_route_alerts where series_id is not null), '2|2',
  'each route follower hears about a series once');
select is(pg_temp.val('b', $$select count(*) from public.ride_series$$) || pg_temp.act('b', $$select public.set_ride_series_status(
    (select id from public.ride_series), 'paused')$$), '0ride_series_not_found', 'a series is its owner''s alone');
select is(pg_temp.act('b', $$select public.book_ride_seat((select post_id from public.post_ride_details
    where series_id is not null order by departs_at desc limit 1))$$), 'ok', 'an occurrence is booked like any ride');
select is(pg_temp.act('c', $$select public.set_ride_series_status((select id from public.ride_series), 'paused')$$)
    || '|' || pg_temp.val(null, 'select count(*) from public.post_ride_details where series_id is not null'), 'ok|1',
  'pausing removes the unbooked occurrences and keeps the booked one');
select is(pg_temp.act('c', $$select public.update_ride_series((select id from public.ride_series), '08:00', 127)$$)
    || '|' || pg_temp.val(null, 'select count(*) from public.post_ride_details where series_id is not null'), 'ok|1',
  'a paused series is rescheduled without publishing');
select is(pg_temp.act('c', $$select public.set_ride_series_status((select id from public.ride_series), 'active')$$)
    || '|' || pg_temp.val(null, $$select count(*) >= 30 and bool_or((departs_at at time zone 'Asia/Jerusalem')::time = '08:00')
         from public.post_ride_details where series_id is not null$$), 'ok|true',
  'resuming publishes again, on the new schedule');
select is(pg_temp.val('b', $$select count(*) filter (where series_more > 0) || '|' || count(*) filter (where series_id is not null and departs_at
    >= ((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp at time zone 'Asia/Jerusalem') from public.rides_feed(null, 100)$$),
  '1|1', 'the feed folds the later dates of a series into one row');
select is(pg_temp.act('c', $$select public.set_ride_series_status((select id from public.ride_series), 'cancelled')$$)
    || '|' || pg_temp.val(null, $$select (select count(*) from public.post_ride_details where series_id is not null)
         || '|' || (select count(*) from public.posts where title = 'daily' and status = 'open')
         || '|' || (select string_agg(h.status || ':' || h.cancel_reason, ',') from public.post_handoffs h
                      join public.posts p on p.id = h.post_id where p.title = 'daily')$$), 'ok|0|0|cancelled:post_deleted',
  'cancelling the series ends its booked ride too, and the seat ends with it (FR-RIDE-046 AC6)');
select is(pg_temp.act('c', $$select public.set_ride_series_status((select id from public.ride_series), 'active')$$),
  'illegal_transition', 'a cancelled series is never resumed');

-- ── Feed, expiry, deletion, account removal ─────────────────────────────────
select is(pg_temp.val('b', $$select string_agg(title, ' ' order by title) from public.rides_feed(null, 50,
    '{"origin":{"city_id":"c1"},"dest":{"city_id":"c2"},"direction":"offer"}') where owner_id = @a$$), 'r1 r6',
  'the route search returns the open rides along the route');
select is(pg_temp.val('b', $$select seats_left || '|' || origin_name || '|' || dest_name from public.rides_feed(null, 50) where title = 'r1'$$),
  '0|s1, c1|c2', 'a row carries free seats and place names');
select is(pg_temp.val('d', $$select count(*) from public.rides_feed() where owner_id = @a$$), '0', 'the feed obeys row access');
select is(pg_temp.val('b', $$select count(*) from public.rides_feed((select next_cursor from public.rides_feed(null, 1)), 50) f
    where f.post_id = (select post_id from public.rides_feed(null, 1))$$), '0', 'the cursor continues after the last row');
select is(pg_temp.act('b', $$select * from public.rides_feed(null, 10, '{"origin":{"city_id":"zz"}}')$$), 'ride_place_invalid',
  'a route filter names official places');
update public.posts set expires_at = now() - interval '1 minute' where title = 'r1';
select is(kc_private.post_expiry_sweep() || '|' || pg_temp.val(null, $$select p.status || '|' || (select string_agg(
    h.status || ':' || h.cancel_reason, ' ' order by h.recipient_id) from public.post_handoffs h where h.post_id = p.id and h.recipient_id in (@b, @c))
    from public.posts p where p.title = 'r1'$$) || '|' || pg_temp.told('post_expired', 'a'),
  '1|expired|cancelled:not_completed cancelled:passenger_cancelled cancelled:expired|1', 'the sweep expires a ride and ends its bookings with their reasons');
select is(pg_temp.told('ride_booking_lapsed', 'b') || '|' || pg_temp.told('ride_booking_cancelled', 'b'), '1|2',
  'a passenger whose seat went with an expired ride hears that the ride did not run; the cancellations they heard before (a withdrawn seat, the cancelled series) stay the only ones');
select is(pg_temp.act('b', $$select public.book_ride_seat(#r6)$$) || pg_temp.act('a', $$select public.delete_post(#r6)$$)
    || '|' || pg_temp.val(null, $$select cancel_reason from public.post_handoffs where id = ~r6.b$$)
    || '|' || pg_temp.told('ride_booking_cancelled', 'b'), 'okok|post_deleted|3', 'deleting a ride cancels its bookings and tells the passenger');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.post_ride_details r join public.posts p on p.id = r.post_id where p.owner_id = '00000000-0000-4000-8000-00000000000a')
    || '|' || (select count(*) from public.post_emergencies) || '|' || (select count(*) from public.ride_route_alerts where series_id is null),
  '0|0|0', 'removing the driver removes their rides, calls and alerts');

select * from finish();
rollback;
