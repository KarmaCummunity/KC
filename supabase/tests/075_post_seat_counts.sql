-- Seats of events and rides (post_seat_counts): every reader of an event or a ride offer
-- sees its places held, its waiting list and its seats left, without reading anyone's
-- registration; a post the caller cannot read gives no row; signed-out callers get nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @a … @e members, #name the post titled `name`.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute v_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The seat counts of one post as a member sees them: capacity|taken|waiting|left, or 'none'.
create function pg_temp.seats(p_who text, p_title text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, format($q$select coalesce((
      select concat_ws('|', coalesce(capacity::text, '-'), seats_taken, waitlisted, coalesce(seats_left::text, '-'))
        from public.post_seat_counts(array[#%s])), 'none')$q$, p_title));
$$;

create function pg_temp.post(p_who text, p_world text, p_type text, p_direction text, p_title text, p_details jsonb)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, format($q$select 'ok' from public.create_post_with_details(%L::jsonb, %L::jsonb)$q$,
    jsonb_build_object('world_slug', p_world, 'post_type', p_type, 'direction', p_direction, 'title', p_title,
      'city_id', 'c1', 'kind_id', (select k.id from public.post_kinds k where k.slug = p_world || '_' || p_direction)),
    p_details));
$$;

select plan(10);

-- Alice organizes and drives; Bob, Carol and Eve take part; Dan blocked Alice.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(34.99 32.79)');
insert into public.worlds (slug, label_he, label_en) values ('time', 'time', 'time'), ('rides', 'rides', 'rides');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('time', 'time_offer', 'e', 'e', 'offer'),
  ('rides', 'rides_offer', 'o', 'o', 'offer'), ('rides', 'rides_request', 'r', 'r', 'request');

select is(
  pg_temp.post('a', 'time', 'event', 'offer', 'shift', jsonb_build_object(
    'starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 3 hours', 'capacity', 2))
  || pg_temp.post('a', 'time', 'event', 'offer', 'open_house', jsonb_build_object(
    'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 1 hour'))
  || pg_temp.as_member('a', $$select 'ok' from public.accept_world_consent('driver_declaration', 1)$$)
  || pg_temp.post('a', 'rides', 'ride', 'offer', 'ride', jsonb_build_object(
    'origin_city_id', 'c1', 'dest_city_id', 'c2', 'departs_at', now() + interval '1 day', 'seats', 3))
  || pg_temp.post('c', 'rides', 'ride', 'request', 'lift', jsonb_build_object(
    'origin_city_id', 'c1', 'dest_city_id', 'c2', 'departs_at', now() + interval '1 day', 'seats', 2)),
  'okokokokok', 'two events, a ride offer and a ride request');
select is(pg_temp.seats('b', 'shift'), '2|0|0|2', 'a new event has all its places left');

-- Bob and Carol fill the shift, Eve waits; Bob books one seat on the ride.
select is(pg_temp.as_member('b', 'select (public.register_for_event(#shift)).status')
    || '|' || pg_temp.as_member('c', 'select (public.register_for_event(#shift)).status')
    || '|' || pg_temp.as_member('e', 'select (public.register_for_event(#shift)).status')
    || '|' || pg_temp.as_member('b', 'select (public.book_ride_seat(#ride, 1)).status'),
  'confirmed|confirmed|waitlisted|reserved', 'two registrations fill the shift, one waits, one seat is booked');
select is(pg_temp.seats('e', 'shift'), '2|2|1|0', 'a waiting member sees the full shift and the line');
select is(pg_temp.seats('d', 'shift') || '/' || pg_temp.seats('d', 'ride'), 'none/none',
  'a member blocked by the organizer reads no counts');
select is(pg_temp.seats('e', 'ride') || '/' || pg_temp.seats('a', 'ride'), '3|1|0|2/3|1|0|2',
  'a ride offer shows its free seats to a stranger and to its driver alike');
select is(pg_temp.seats('b', 'open_house') || '/' || pg_temp.seats('b', 'lift'), '-|0|0|-/-|0|0|-',
  'an event without a capacity and a ride request have no seats left to show');
select is(pg_temp.as_member('a', $$select 'ok' from public.pause_post(#open_house)$$) || '/' || pg_temp.seats('b', 'open_house')
    || '/' || pg_temp.seats('a', 'open_house'), 'ok/none/-|0|0|-',
  'a paused event is counted for its organizer only');
select is(pg_temp.as_member('b', 'select count(*)::text from public.post_seat_counts(array[gen_random_uuid()])'), '0',
  'an unknown post gives no row');
select is(pg_temp.as_member(null, 'select count(*)::text from public.post_seat_counts(array[#ride])'), '42501',
  'a signed-out caller cannot read seat counts');

select * from finish();
rollback;
