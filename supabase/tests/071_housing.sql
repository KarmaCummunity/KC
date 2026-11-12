-- Housing: a stay offer needs a verified host who accepted the code of conduct; requests
-- obey dates, party and policy; capacity is kept per night under competing requests and
-- the first approval wins; cancellations are flagged when late; a stay is closed inside
-- its window; the address is released to the approved guest for a limited time; sweeps,
-- deletion and account removal clean up.
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

-- Creates a stay offer as a member, with extra detail fields.
create function pg_temp.stay(p_who text, p_title text, p_extra jsonb default '{}', p_direction text default 'offer')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.create_post_with_details(%L::jsonb, %L::jsonb)',
    jsonb_build_object('world_slug', 'housing', 'post_type', 'housing_stay', 'direction', p_direction,
      'title', p_title, 'city_id', 'c1', 'kind_id', (select k.id from public.post_kinds k where k.slug = 'host')),
    jsonb_build_object('place_type', 'private_room', 'capacity', 2, 'max_nights', 5) || p_extra));
$$;

-- Asks for a stay as a member: nights from today + p_in to today + p_out (Israel dates).
create function pg_temp.ask(
  p_who text, p_title text, p_in integer, p_out integer, p_adults integer default 1, p_minors integer default 0,
  p_message text default 'hello', p_ack boolean default false)
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.request_housing_booking(#%s, %L, %L, %s, %s, %L, %L)', p_title,
    (now() at time zone 'Asia/Jerusalem')::date + p_in, (now() at time zone 'Asia/Jerusalem')::date + p_out,
    p_adults, p_minors, p_message, p_ack));
$$;

-- Moves the time slot of a booking, as time passing would.
create function pg_temp.slot(p_booking text, p_start interval, p_end interval)
returns void
language plpgsql
as $$
begin
  execute pg_temp.expand(format(
    'update public.post_handoffs set slot_starts_at = now() + %L::interval, slot_ends_at = now() + %L::interval where id = %s',
    p_start, p_end, p_booking));
end;
$$;

select plan(75);

-- Alice hosts. Bob and Carol are verified guests. Dan is not verified; Eve did not accept
-- the code of conduct.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set verification_level = 2 where id <> '00000000-0000-4000-8000-00000000000d';
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en, requires_verification) values ('housing', 'housing', 'housing', true);
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values ('housing', 'host', 'h', 'h', 'either');
select is(pg_temp.act('a', $$select public.accept_world_consent('housing_conduct', 1)$$)
    || pg_temp.act('b', $$select public.accept_world_consent('housing_conduct', 1)$$)
    || pg_temp.act('c', $$select public.accept_world_consent('housing_conduct', 1)$$)
    || pg_temp.act('d', $$select public.accept_world_consent('housing_conduct', 1)$$), 'okokokok',
  'members accept the code of conduct');

-- ── Creating a stay offer ───────────────────────────────────────────────────
select is(pg_temp.stay('d', 'bad'), 'verification_required', 'hosting needs a verified identity');
select is(pg_temp.stay('e', 'bad'), 'housing_conduct_required', 'and the code of conduct');
select is(pg_temp.stay('a', 'bad', '{"place_type":"couch","exclusive":true}'), '23514', 'a couch is never exclusive');
select is(pg_temp.stay('a', 'bad', '{"min_nights":4,"max_nights":2}'), '23514', 'nights must be a range');
select is(pg_temp.stay('a', 'bad', '{"capacity":21}'), '23514', 'capacity is bounded');
select is(pg_temp.stay('a', 'bad', '{}', 'request'), 'post_details_mismatch', 'only an offer has stay details');
select is(pg_temp.stay('a', 'h1') || pg_temp.stay('a', 'h3') || pg_temp.stay('a', 'h4'), 'okokok', 'stay offers are published');
select is(pg_temp.stay('a', 'h2', jsonb_build_object('place_type', 'whole_unit', 'capacity', 4, 'exclusive', true,
    'children_ok', true, 'available_until', (now() at time zone 'Asia/Jerusalem')::date + 20,
    'blackout_dates', array[(now() at time zone 'Asia/Jerusalem')::date + 12])), 'ok', 'an exclusive unit with a window');
select is(pg_temp.val(null, $$select (select expires_at is null from public.posts where title = 'h1') || '|' ||
    (select expires_at = ((now() at time zone 'Asia/Jerusalem')::date + 21)::timestamp at time zone 'Asia/Jerusalem'
       from public.posts where title = 'h2')$$), 'true|true', 'an offer with a closing date expires when that day ends');
select is(pg_temp.val('b', $$select count(*) from public.post_housing_details$$) || pg_temp.act(null, $$select 1 from public.post_housing_details$$),
  '442501', 'members read the terms, signed-out callers nothing');
select is(pg_temp.act('b', $$update public.post_housing_details set capacity = 9 where post_id = #h1$$)
    || pg_temp.act('a', $$update public.post_housing_details set pets_ok = true where post_id = #h1$$)
    || pg_temp.val(null, $$select capacity || '|' || pets_ok from public.post_housing_details where post_id = #h1$$),
  'okok2|true', 'only the host edits the terms');
select is(pg_temp.act('a', $$insert into public.post_housing_details (post_id, place_type, capacity) values (#h1, 'couch', 1)$$),
  '42501', 'a detail row is never inserted from a device');

-- ── Requesting ──────────────────────────────────────────────────────────────
select is(pg_temp.ask('d', 'h1', 10, 12), 'verification_required', 'a guest needs a verified identity');
select is(pg_temp.ask('e', 'h1', 10, 12), 'housing_conduct_required', 'and the code of conduct');
select is(pg_temp.ask('a', 'h1', 10, 12), 'own_listing', 'the host cannot book their own place');
select is(pg_temp.ask('b', 'h1', -1, 2), 'housing_dates_invalid', 'a stay cannot start in the past');
select is(pg_temp.ask('b', 'h1', 200, 202), 'housing_dates_invalid', 'nor more than 180 days ahead');
select is(pg_temp.ask('b', 'h1', 10, 16), 'housing_nights_out_of_range', 'nights follow the offer');
select is(pg_temp.ask('b', 'h1', 10, 12, 0), 'housing_capacity_exceeded', 'a party has an adult');
select is(pg_temp.ask('b', 'h1', 10, 12, 3), 'housing_capacity_exceeded', 'a party fits the place');
select is(pg_temp.ask('b', 'h1', 10, 12, 1, 1), 'housing_policy_mismatch', 'children only where they are welcome');
select is(pg_temp.ask('b', 'h2', 10, 11, 1, 1), 'housing_minor_unaccompanied', 'minors need a guardian''s acknowledgement');
select is(pg_temp.ask('b', 'h1', 10, 12, 2, 0, '  '), 'housing_message_required', 'a request introduces the guest');
select is(pg_temp.ask('b', 'h2', 12, 13), 'housing_dates_unavailable', 'a blacked-out night is not bookable');
select is(pg_temp.ask('b', 'h2', 20, 22), 'housing_dates_unavailable', 'nor a night outside the window');
select is(pg_temp.ask('b', 'h1', 10, 12, 2), 'ok', 'a guest asks to stay');
select is(pg_temp.val(null, $$select h.status || '|' || h.seats || '|' || (h.confirm_by = now() + interval '24 hours') || '|' || d.adults
    || '|' || (h.slot_starts_at = ((now() at time zone 'Asia/Jerusalem')::date + 10 + time '16:00') at time zone 'Asia/Jerusalem')
    from public.post_handoffs h join public.handoff_booking_details d on d.handoff_id = h.id where h.id = ~h1.b$$),
  'reserved|2|true|2|true', 'the request waits 24 hours and carries its dates and party');
select is(pg_temp.ask('b', 'h1', 20, 22), 'item_already_reserved', 'one live booking per guest and place');
select is(pg_temp.ask('b', 'h2', 10, 11, 1, 1, 'hi', true) || pg_temp.ask('b', 'h3', 20, 22), 'okok', 'two more requests');
select is(pg_temp.ask('b', 'h4', 30, 31), 'housing_pending_cap', 'at most three waiting requests');
select is(pg_temp.ask('c', 'h1', 11, 13), 'ok', 'a waiting request holds no bed: another guest may ask for the same nights');
select is(pg_temp.val('a', $$select count(*) from public.handoff_booking_details$$) || pg_temp.val('c', $$select count(*) from public.handoff_booking_details$$)
    || pg_temp.val('e', $$select count(*) from public.handoff_booking_details$$), '410', 'a booking is visible to its host and guest only');
select is(pg_temp.told('housing_booking_requested', 'a'), 4::bigint, 'the host is told about each request');

-- ── Deciding: capacity per night, first approval wins ───────────────────────
select is(pg_temp.act('b', $$select public.decide_housing_booking(~h1.b, true)$$), 'handoff_not_found', 'only the host decides');
select is(pg_temp.act('a', $$select public.decide_housing_booking(~h1.b, true, repeat('x', 301))$$), 'housing_note_too_long',
  'a note is short');
select is(pg_temp.act('a', $$select public.decide_housing_booking(~h1.b, true, 'welcome')$$), 'ok', 'the host approves');
select is(pg_temp.act('a', $$select public.decide_housing_booking(~h1.b, true)$$), 'invalid_status', 'a decision is taken once');
select is(pg_temp.val(null, $$select string_agg(p.title || ':' || h.status || ':' || coalesce(h.cancel_reason, '-'), ' ' order by p.title)
    from public.post_handoffs h join public.posts p on p.id = h.post_id where h.recipient_id = @b$$),
  'h1:confirmed:- h2:cancelled:superseded h3:reserved:-', 'the guest''s overlapping request is withdrawn, the other waits on');
select is(pg_temp.told('housing_booking_confirmed', 'b') || '|' || pg_temp.told('housing_booking_cancelled', 'b'), '1|1',
  'the guest hears the approval and the withdrawal of the other request');
select is(pg_temp.act('a', $$select public.decide_housing_booking(~h1.c, true)$$), 'housing_capacity_exceeded',
  'an approval cannot overfill a night');
select is(pg_temp.act('a', $$update public.post_housing_details set capacity = 1 where post_id = #h1$$),
  'housing_active_booking_conflict', 'capacity cannot drop below an approved stay');
select is(pg_temp.act('a', $$select public.decide_housing_booking(~h1.c, false, 'full, sorry')$$)
    || '|' || pg_temp.val(null, $$select h.cancel_reason || '|' || d.decision_note from public.post_handoffs h
         join public.handoff_booking_details d on d.handoff_id = h.id where h.id = ~h1.c$$), 'ok|declined|full, sorry',
  'the host declines with a note');
select is(pg_temp.ask('b', 'h4', 11, 12), 'housing_booking_overlap', 'a guest holds no two approved stays on the same nights');
select is(pg_temp.ask('c', 'h2', 14, 15) || pg_temp.act('a', $$select public.decide_housing_booking(~h2.c, true)$$), 'okok',
  'a stay in the exclusive unit is approved');
select is(pg_temp.ask('b', 'h2', 14, 15), 'housing_capacity_exceeded', 'an exclusive unit takes one booking a night');
update public.users set verification_level = 0 where id = '00000000-0000-4000-8000-00000000000c';
select is(pg_temp.ask('c', 'h3', 30, 31), 'verification_required', 'a guest who lost verification cannot ask');
update public.users set verification_level = 2 where id = '00000000-0000-4000-8000-00000000000c';

-- ── Address release ─────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$insert into public.post_private_locations (post_id, street, street_number) values (#h1, 'Herzl', '7')$$)
    || pg_temp.act('b', $$select public.get_post_private_location(#h1)$$)
    || pg_temp.act('c', $$select public.get_post_private_location(#h1)$$), 'okokpost_not_found',
  'the address reaches the approved guest only');

-- ── Cancelling ──────────────────────────────────────────────────────────────
select is(pg_temp.act('e', $$select public.cancel_housing_booking(~h2.c)$$), 'handoff_not_found', 'a stranger cannot cancel');
select is(pg_temp.act('a', $$select public.cancel_housing_booking(~h2.c)$$), 'housing_cancel_reason_required',
  'a host cancelling an approved stay says why');
select is(pg_temp.act('a', $$select public.cancel_housing_booking(~h2.c, 'family emergency')$$)
    || '|' || pg_temp.val(null, $$select h.cancel_reason || '|' || d.late_cancel || '|' || d.cancel_note from public.post_handoffs h
         join public.handoff_booking_details d on d.handoff_id = h.id where h.id = ~h2.c$$),
  'ok|host_cancelled|false|family emergency', 'an early host cancellation is not late');
select is(pg_temp.act('b', $$select public.cancel_housing_booking(~h3.b)$$)
    || '|' || pg_temp.val(null, $$select cancel_reason from public.post_handoffs where id = ~h3.b$$), 'ok|guest_cancelled',
  'a guest withdraws a waiting request');
select is(pg_temp.act('b', $$select public.cancel_housing_booking(~h3.b)$$), 'invalid_status', 'a cancelled booking is not cancelled again');
select is(pg_temp.ask('c', 'h3', 20, 21) || pg_temp.act('a', $$select public.decide_housing_booking(~h3.c, true)$$), 'okok',
  'another approved stay');
do $$ begin perform pg_temp.slot('~h3.c', '10 hours', '2 days'); end $$;
select is(pg_temp.act('c', $$select public.cancel_housing_booking(~h3.c)$$)
    || '|' || pg_temp.val(null, $$select h.cancel_reason || '|' || d.late_cancel from public.post_handoffs h
         join public.handoff_booking_details d on d.handoff_id = h.id where h.id = ~h3.c$$), 'ok|guest_cancelled|true',
  'a guest cancelling inside 24 hours of the start is flagged');
select is(pg_temp.ask('c', 'h4', 5, 6) || pg_temp.act('a', $$select public.decide_housing_booking(~h4.c, true)$$), 'okok',
  'one more approved stay');
do $$ begin perform pg_temp.slot('~h4.c', '30 hours', '3 days'); end $$;
select is(pg_temp.act('a', $$select public.cancel_housing_booking(~h4.c, 'changed plans')$$)
    || '|' || pg_temp.val(null, $$select late_cancel from public.handoff_booking_details where handoff_id = ~h4.c$$), 'ok|true',
  'a host cancelling inside 48 hours of the start is flagged');

-- ── Closing a stay: completed or no-show, each in its window ────────────────
select is(pg_temp.act('a', $$select public.close_housing_booking(~h1.b, 'completed')$$), 'housing_not_in_window',
  'a stay is not completed before it starts');
do $$ begin perform pg_temp.slot('~h1.b', '-1 hour', '1 day'); end $$;
select is(pg_temp.act('b', $$select public.cancel_housing_booking(~h1.b)$$), 'housing_booking_started',
  'a stay that started is not cancelled');
select is(pg_temp.act('a', $$select public.close_housing_booking(~h1.b, 'no_show')$$), 'housing_not_in_window',
  'a no-show is reported from three hours after check-in');
select is(pg_temp.act('a', $$select public.close_housing_booking(~h1.b, 'left')$$), 'invalid_status', 'an unknown outcome is refused');
select is(pg_temp.act('b', $$select public.close_housing_booking(~h1.b, 'completed')$$), 'handoff_not_found', 'only the host closes a stay');
select is(pg_temp.act('e', $$select public.report_post_emergency(#h1)$$), 'emergency_not_active', 'a stranger cannot call for help');
select is(pg_temp.act('b', $$select public.report_post_emergency(#h1)$$) || '|' || pg_temp.told('post_emergency', 'a'), 'ok|1',
  'a guest whose stay is under way calls for help and the host is alerted');
select is(pg_temp.act('a', $$select public.close_housing_booking(~h1.b, 'completed')$$)
    || '|' || pg_temp.val(null, $$select h.status || '|' || p.status from public.post_handoffs h join public.posts p on p.id = h.post_id
         where h.id = ~h1.b$$), 'ok|handed_over|open', 'the host completes the stay; the offer stays open');
select is((select count(*) from kc_private.outbox_events e where e.topic = 'karma' and e.payload ->> 'kind' = 'handoff_completed'),
  1::bigint, 'a karma event is recorded');
select is(pg_temp.act('a', $$select public.close_housing_booking(~h1.b, 'completed')$$), 'invalid_status', 'a stay is closed once');
do $$ begin perform pg_temp.slot('~h1.b', '-3 days', '-25 hours'); end $$;
select is(pg_temp.act('b', $$select public.get_post_private_location(#h1)$$), 'post_not_found',
  'the address is no longer released 24 hours after the stay');
select is(pg_temp.ask('c', 'h4', 7, 8) || pg_temp.act('a', $$select public.decide_housing_booking(~h4.c, true)$$), 'okok',
  'a stay whose guest will not come');
do $$ begin perform pg_temp.slot('~h4.c', '-4 hours', '1 day'); end $$;
select is(pg_temp.act('a', $$select public.close_housing_booking(~h4.c, 'no_show')$$)
    || '|' || pg_temp.val(null, $$select status from public.post_handoffs where id = ~h4.c$$), 'ok|no_show', 'the host reports a no-show');

-- ── Sweeps, deletion, account removal ───────────────────────────────────────
select is(pg_temp.ask('c', 'h3', 25, 26) || pg_temp.act('a', $$select public.decide_housing_booking(~h3.c, true)$$)
    || pg_temp.ask('c', 'h1', 40, 41) || pg_temp.ask('b', 'h4', 50, 51), 'okokokok', 'an approved stay and two waiting requests');
do $$ begin perform pg_temp.slot('~h3.c', '-10 days', '-8 days'); end $$;
update public.post_handoffs set confirm_by = now() - interval '1 minute'
 where recipient_id = '00000000-0000-4000-8000-00000000000c' and status = 'reserved';
select is(kc_private.housing_not_completed_sweep() || '|' || kc_private.handoff_reservation_expiry_sweep()
    || '|' || pg_temp.val(null, $$select (select cancel_reason from public.post_handoffs where id = ~h3.c)
         || '|' || (select cancel_reason from public.post_handoffs where id = ~h1.c)$$), '1|1|not_completed|expired',
  'a stay nobody closed and a request nobody answered lapse');
update public.posts set expires_at = now() - interval '1 minute' where title = 'h4';
select is(kc_private.post_expiry_sweep() || '|' || pg_temp.val(null, $$select p.status || '|' || h.cancel_reason
    from public.posts p join public.post_handoffs h on h.post_id = p.id where h.id = ~h4.b$$), '1|expired|expired',
  'an offer past its closing date expires and its waiting request with it');
select is(pg_temp.ask('b', 'h3', 60, 61) || pg_temp.act('a', $$select public.delete_post(#h3)$$)
    || '|' || pg_temp.val(null, $$select cancel_reason from public.post_handoffs where id = ~h3.b$$), 'okok|post_deleted',
  'deleting an offer cancels its requests');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.post_housing_details) + (select count(*) from public.handoff_booking_details), 0::bigint,
  'removing the host removes the offers and their bookings');

select * from finish();
rollback;
