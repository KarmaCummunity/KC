-- Events (and volunteering shifts): an event is created with its window, capacity and
-- policy; registration confirms, waits for approval or joins the waiting list; a freed or
-- added place promotes the list in order; attendance is marked from the start, an absence
-- can be corrected, and a shift adds volunteering hours; the organizer messages the
-- registrants; pausing, deleting and expiry treat registrations as the spec says.
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

-- Creates an event as a member: starting after p_in, three hours long, with extra fields.
create function pg_temp.event(p_who text, p_title text, p_in interval, p_extra jsonb default '{}')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.create_post_with_details(%L::jsonb, %L::jsonb)',
    jsonb_build_object('world_slug', 'time', 'post_type', 'event', 'direction', 'offer', 'title', p_title,
      'city_id', 'c1', 'kind_id', (select k.id from public.post_kinds k where k.slug = 'event')),
    jsonb_build_object('starts_at', now() + p_in, 'ends_at', now() + p_in + interval '3 hours') || p_extra));
$$;

-- 'status' or 'status:reason' of a member's newest registration on an event.
create function pg_temp.reg(p_title text, p_who text)
returns text
language sql
as $$
  select pg_temp.val(null, format(
    $q$select status || coalesce(':' || cancel_reason, '') from public.post_handoffs where id = ~%s.%s$q$, p_title, p_who));
$$;

select plan(64);

-- Alice organizes. Bob, Carol and Eve attend; only Eve has a verified identity. Dan and
-- Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set verification_level = 2 where id = '00000000-0000-4000-8000-00000000000e';
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('time', 'time', 'time');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values ('time', 'event', 'e', 'e', 'offer');

-- ── Creating an event ───────────────────────────────────────────────────────
select is(pg_temp.event('a', 'bad', '-1 hour'), 'event_time_invalid', 'an event starts in the future');
select is(pg_temp.event('a', 'bad', '1 day', jsonb_build_object('ends_at', now())), 'event_time_invalid', 'it ends after it starts');
select is(pg_temp.event('a', 'bad', '1 day', '{"capacity":0}'), '23514', 'capacity is positive');
select is(pg_temp.event('a', 'ev1', '1 day', '{"capacity":2,"counts_volunteer_hours":true,"address_label":"Community centre"}'),
  'ok', 'a volunteering shift with two places');
select is(pg_temp.event('a', 'ev2', '1 day', '{"capacity":1,"registration_policy":"manual"}')
    || pg_temp.event('a', 'ev3', '1 day', '{"registration_policy":"verified_only"}'), 'okok', 'two more events');
select is(pg_temp.val(null, $$select (lower(time_window) = now() + interval '1 day') || '|' || (expires_at = now() + interval '1 day 3 hours')
    from public.posts where title = 'ev1'$$), 'true|true', 'the post carries the window and expires when the event ends');
select is(pg_temp.act('a', $$insert into public.posts (owner_id, world_slug, kind_id, post_type, direction, title, city_id)
    select @a, 'time', id, 'event', 'offer', 'bare', 'c1' from public.post_kinds;
    set constraints all immediate$$), 'post_details_required', 'an event post cannot exist without its details');
select is(pg_temp.val('b', $$select count(*) from public.post_event_details$$) || pg_temp.val('d', $$select count(*) from public.post_event_details$$)
    || pg_temp.act(null, $$select 1 from public.post_event_details$$), '3042501', 'details follow the visibility of the post');
select is(pg_temp.act('b', $$update public.post_event_details set capacity = 99 where post_id = #ev1$$)
    || pg_temp.act('a', $$update public.post_event_details set address_label = 'Main hall' where post_id = #ev1$$)
    || pg_temp.val(null, $$select capacity || '|' || address_label from public.post_event_details where post_id = #ev1$$),
  'okok2|Main hall', 'only the organizer edits the event');

-- ── Registration, capacity and the waiting list ─────────────────────────────
select is(pg_temp.act('b', $$select public.register_for_event(#ev1)$$) || '|' || pg_temp.reg('ev1', 'b'), 'ok|confirmed',
  'an open event confirms at once');
select is(pg_temp.told('event_registration_claimed', 'a'), 1::bigint, 'the organizer is told');
select is(pg_temp.act('a', $$select public.register_for_event(#ev1)$$), 'own_listing', 'the organizer does not register');
select is(pg_temp.act('d', $$select public.register_for_event(#ev1)$$), 'listing_not_available', 'a blocked member cannot register');
select is(pg_temp.act('b', $$select public.register_for_event(#ev1)$$), 'item_already_reserved', 'a member registers once');
select is(pg_temp.act('b', $$select public.register_for_event(gen_random_uuid())$$), 'listing_not_available', 'an unknown event');
select is(pg_temp.act('c', $$select public.register_for_event(#ev1)$$) || pg_temp.act('e', $$select public.register_for_event(#ev1)$$)
    || '|' || pg_temp.reg('ev1', 'c') || '|' || pg_temp.reg('ev1', 'e'), 'okok|confirmed|waitlisted',
  'the last place is given once; the next member waits');
select is(pg_temp.act('a', $$update public.post_event_details set capacity = 1 where post_id = #ev1$$),
  'event_capacity_below_registrations', 'capacity cannot drop below the places taken');
select is(pg_temp.act('e', $$select public.cancel_event_registration(~ev1.b)$$), 'handoff_not_found', 'a stranger cannot cancel');
select is(pg_temp.act('b', $$select public.cancel_event_registration(~ev1.b)$$) || '|' || pg_temp.reg('ev1', 'b') || '|' || pg_temp.reg('ev1', 'e'),
  'ok|cancelled:recipient_cancelled|confirmed', 'a freed place goes to the head of the waiting list');
select is(pg_temp.told('event_registration_waitlist_promoted', 'e'), 1::bigint, 'who is told');
select is(pg_temp.act('b', $$select public.cancel_event_registration(~ev1.b)$$), 'invalid_status', 'a cancelled registration is not cancelled again');
select is(pg_temp.act('b', $$select public.register_for_event(#ev1)$$) || '|' || pg_temp.reg('ev1', 'b'), 'ok|waitlisted', 'Bob waits now');
select is(pg_temp.act('a', $$update public.post_event_details set capacity = 3 where post_id = #ev1$$) || '|' || pg_temp.reg('ev1', 'b'),
  'ok|confirmed', 'a raised capacity promotes the waiting list');

-- ── Approval by the organizer ───────────────────────────────────────────────
select is(pg_temp.act('b', $$select public.register_for_event(#ev2)$$) || '|' || pg_temp.reg('ev2', 'b') || '|' ||
    pg_temp.val(null, $$select confirm_by = now() + interval '1 day' from public.post_handoffs where id = ~ev2.b$$),
  'ok|reserved|true', 'a manual event waits for the organizer until it starts');
select is(pg_temp.act('c', $$select public.register_for_event(#ev2)$$) || '|' || pg_temp.reg('ev2', 'c'), 'ok|waitlisted',
  'a request holds its place');
select is(pg_temp.act('c', $$select public.decide_event_registration(~ev2.b, true)$$), 'handoff_not_found', 'only the organizer decides');
select is(pg_temp.act('a', $$select public.decide_event_registration(~ev2.c, true)$$), 'invalid_status', 'a waiting-list entry is not decided');
select is(pg_temp.act('a', $$select public.decide_event_registration(~ev2.b, false)$$) || '|' || pg_temp.reg('ev2', 'b') || '|' || pg_temp.reg('ev2', 'c')
    || '|' || pg_temp.val(null, $$select confirm_by is not null from public.post_handoffs where id = ~ev2.c$$),
  'ok|cancelled:declined|reserved|true', 'a declined place goes to the next member, to be approved in turn');
select is(pg_temp.act('a', $$select public.decide_event_registration(~ev2.c, true)$$) || '|' || pg_temp.reg('ev2', 'c'), 'ok|confirmed',
  'the organizer approves');
select is(pg_temp.told('event_registration_requested', 'a') || '|' || pg_temp.told('event_registration_confirmed', 'c')
    || '|' || pg_temp.told('event_registration_declined', 'b'), '1|1|1', 'each side hears about requests and decisions');
select is(pg_temp.act('b', $$select public.register_for_event(#ev3)$$), 'verification_required', 'a verified-only event');
select is(pg_temp.act('e', $$select public.register_for_event(#ev3)$$) || '|' || pg_temp.reg('ev3', 'e'), 'ok|confirmed',
  'admits a verified member');

-- ── Message to the registrants ──────────────────────────────────────────────
select is(pg_temp.act('b', $$select public.message_event_registrants(#ev1, 'hi')$$), 'post_not_found', 'only the organizer writes to registrants');
select is(pg_temp.act('a', $$select public.message_event_registrants(#ev1, '  ')$$), 'event_message_invalid', 'a message has text');
select is(pg_temp.val('a', $$select public.message_event_registrants(#ev1, 'Bring water')$$) || '|' || pg_temp.told('event_organizer_message', 'b')
    || pg_temp.told('event_organizer_message', 'c') || pg_temp.told('event_organizer_message', 'e') || pg_temp.told('event_organizer_message', 'd'),
  '3|1110', 'every registered member is notified');

-- ── Attendance: from the start, with a correction, and volunteering hours ───
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.b, true)$$), 'event_not_started', 'attendance waits for the start');
update public.post_event_details set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours'
 where post_id = (select id from public.posts where title = 'ev1');
select is(pg_temp.val(null, $$select slot_starts_at = now() - interval '1 hour' from public.post_handoffs where id = ~ev1.b$$), 'true',
  'live registrations follow a moved window');
select is(pg_temp.act('d', $$select public.register_for_event(#ev1)$$), 'listing_not_available', 'still closed to a blocked member');
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000f', 'f@example.test', '{"provider":"google"}');
select is(pg_temp.act('f', $$select public.register_for_event(#ev1)$$), 'slot_started', 'registration closes at the start');
select is(pg_temp.act('b', $$select public.mark_event_attendance(~ev1.b, true)$$), 'handoff_not_found', 'only the organizer marks attendance');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.b, true)$$) || '|' || pg_temp.reg('ev1', 'b') || '|' ||
    pg_temp.val(null, $$select volunteer_hours_total from public.user_stats where user_id = @b$$), 'ok|handed_over|3.00',
  'attending a shift adds its length to the volunteering hours');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.b, false)$$), 'invalid_status', 'an attendance is final');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.c, false)$$) || '|' || pg_temp.reg('ev1', 'c') || '|' ||
    pg_temp.val(null, $$select volunteer_hours_total from public.user_stats where user_id = @c$$), 'ok|no_show|0.00',
  'an absence is recorded without hours');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.c, false)$$), 'invalid_status', 'an absence is recorded once');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.c, true)$$) || '|' || pg_temp.reg('ev1', 'c') || '|' ||
    pg_temp.val(null, $$select volunteer_hours_total from public.user_stats where user_id = @c$$), 'ok|handed_over|3.00',
  'an absence is corrected to attended, with its hours');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev3.e, true)$$), 'event_not_started', 'another event has not started');
select is(pg_temp.act('a', $$select public.complete_ride_trip(~ev1.e)$$) || pg_temp.act('a', $$select public.cancel_giving_handoff(~ev1.e)$$),
  'handoff_not_foundhandoff_world_not_supported', 'a registration is not moved by another world''s RPC');

-- ── Pause, deletion, expiry (D128, D131) ────────────────────────────────────
select is(pg_temp.act('a', $$select public.pause_post(#ev2)$$) || '|' || pg_temp.reg('ev2', 'c') || '|' || pg_temp.told('event_registration_cancelled', 'c'),
  'ok|cancelled:host_cancelled|1', 'pausing an upcoming event cancels its registrations and tells the attendees');
select is(pg_temp.act('a', $$select public.delete_post(#ev3)$$) || '|' || pg_temp.reg('ev3', 'e'), 'ok|cancelled:post_deleted',
  'deleting an event cancels its registrations');
update public.posts set expires_at = now() - interval '1 minute' where title = 'ev1';
select is(kc_private.post_expiry_sweep() || '|' || pg_temp.val(null, $$select status from public.posts where title = 'ev1'$$)
    || '|' || pg_temp.reg('ev1', 'e'), '1|expired|confirmed', 'an ended event expires and keeps its registrations for attendance');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev1.e, true)$$) || '|' || pg_temp.reg('ev1', 'e'), 'ok|handed_over',
  'attendance is still marked after the event expired');
select is(pg_temp.act('e', $$select public.cancel_event_registration(~ev1.e)$$), 'invalid_status', 'an attended registration is not cancelled');

-- ── Reminder, attendance prompt, and what lapses when an event ends ─────────
select is(pg_temp.event('a', 'ev5', '30 hours', '{"capacity":1}') || pg_temp.event('a', 'ev6', '30 hours', '{"registration_policy":"manual"}')
    || pg_temp.act('b', $$select public.register_for_event(#ev5)$$) || pg_temp.act('c', $$select public.register_for_event(#ev5)$$)
    || pg_temp.act('e', $$select public.register_for_event(#ev6)$$)
    || '|' || pg_temp.reg('ev5', 'b') || '|' || pg_temp.reg('ev5', 'c') || '|' || pg_temp.reg('ev6', 'e'),
  'okokokokok|confirmed|waitlisted|reserved', 'a confirmed place, a waiting member and an unanswered request');
select is(kc_private.event_reminder_sweep(), 0, 'no reminder while the event is more than a day away');
update public.post_event_details set starts_at = now() + interval '10 hours', ends_at = now() + interval '13 hours'
 where post_id = (select id from public.posts where title = 'ev5');
select is(kc_private.event_reminder_sweep(), 0, 'nor for a member who registered inside the last day');
update public.post_handoffs set created_at = now() - interval '2 days'
 where recipient_id = '00000000-0000-4000-8000-00000000000b' and post_id = (select id from public.posts where title = 'ev5');
select is(kc_private.event_reminder_sweep() || '|' || pg_temp.told('event_reminder', 'b') || '|' || pg_temp.told('event_reminder', 'c'),
  '1|1|0', 'a confirmed registrant is reminded; the waiting member is not');
select is(pg_temp.val(null, $$select e.payload #>> '{data,dedupe_key}' = 'event_reminder:' || h.id
    from kc_private.outbox_events e, public.post_handoffs h
   where e.payload ->> 'kind' = 'event_reminder' and h.id = ~ev5.b$$), 'true', 'the reminder carries a key, so a second run tells nobody twice');
select is(kc_private.event_attendance_prompt_sweep(), 0, 'the organizer is not prompted before the event ends');
update public.post_event_details set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour'
 where post_id in (select id from public.posts where title in ('ev5', 'ev6'));
select is(kc_private.event_attendance_prompt_sweep() || '|' || pg_temp.told('event_mark_attendance', 'a'), '1|1',
  'after the end the organizer is asked once, for the event with confirmed registrations');
select is(pg_temp.act('a', $$select public.mark_event_attendance(~ev5.b, true)$$) || '|' || kc_private.event_attendance_prompt_sweep(),
  'ok|0', 'nothing is asked once the attendance is marked');
select is(kc_private.post_expiry_sweep() || '|' || pg_temp.reg('ev5', 'b') || '|' || pg_temp.reg('ev5', 'c') || '|' || pg_temp.reg('ev6', 'e'),
  '2|handed_over|cancelled:expired|cancelled:expired', 'the end of an event lapses the waiting list and the unanswered requests; attendance stays');
select is(pg_temp.told('event_registration_expired', 'c') || '|' || pg_temp.told('event_registration_expired', 'e'), '1|1',
  'and each of them is told');

delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.post_event_details) + (select count(*) from public.post_handoffs), 0::bigint,
  'removing the organizer removes the events and their registrations');

select * from finish();
rollback;
