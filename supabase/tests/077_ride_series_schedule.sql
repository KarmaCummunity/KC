-- Recurring rides (FR-RIDE-046): every reader of an occurrence sees its series' weekdays,
-- departure time and last day, through the rides feed and ride_occurrence_schedules; the
-- series row stays its owner's; a member who cannot read the occurrence, a cancelled series
-- and a signed-out caller get nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
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

select plan(8);

-- Alice drives a Monday and Wednesday series; Eve rides; Dan blocked Alice.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(34.99 32.79)');
insert into public.worlds (slug, label_he, label_en) values ('rides', 'rides', 'rides');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values ('rides', 'ride_offer', 'o', 'o', 'offer');

select is(pg_temp.as_member('a', $$select 'ok' from public.accept_world_consent('driver_declaration', 1)$$)
    || pg_temp.as_member('a', format($$select 'ok' from public.create_ride_series(%L::jsonb,
         '{"origin_city_id":"c1","dest_city_id":"c2","seats":3}', '07:30', 10, null, current_date + 60)$$,
         jsonb_build_object('world_slug', 'rides', 'direction', 'offer', 'title', 'commute', 'city_id', 'c1',
           'kind_id', (select id from public.post_kinds where slug = 'ride_offer')))),
  'okok', 'a series on Mondays and Wednesdays at 07:30');

select is(pg_temp.as_member('b', $$select string_agg(distinct series_weekdays || '@' || series_depart_time
      || '/' || (extract(dow from series_on) in (1, 3)), ',') from public.rides_feed()$$),
  '10@07:30:00/true', 'the feed marks each occurrence with its day, weekdays and departure time');
select is(pg_temp.as_member('b', $$select count(*)::text from public.ride_series$$), '0',
  'the series row itself stays its owner''s');
select is(pg_temp.as_member('b', $$select count(distinct weekdays) || '|' || min(weekdays) || '|' || min(depart_time)
      || '|' || (min(ends_on) = current_date + 60) || '|' || bool_and(series_on is not null)
      from public.ride_occurrence_schedules(array(select post_id from public.post_ride_details))$$),
  '1|10|07:30:00|true|true', 'an occurrence''s detail reads the schedule of its series');
select is(pg_temp.as_member('d', $$select count(*)::text from public.ride_occurrence_schedules(
      array(select r.post_id from public.post_ride_details r))$$)
    || pg_temp.as_member('d', $$select count(*)::text from public.rides_feed()$$), '00',
  'a member blocked by the driver reads neither the occurrences nor their schedule');
select is(pg_temp.as_member(null, $$select count(*)::text from public.ride_occurrence_schedules(array[gen_random_uuid()])$$),
  '42501', 'a signed-out caller cannot read a schedule');

-- Eve books the soonest occurrence; Alice cancels the series and the booked ride stays single.
select is(pg_temp.as_member('e', $$select (public.book_ride_seat((select r.post_id from public.post_ride_details r
      order by r.departs_at limit 1), 1)).status$$)
    || '|' || pg_temp.as_member('a', $$select 'ok' from public.set_ride_series_status((select id from public.ride_series), 'cancelled')$$),
  'reserved|ok', 'a booked occurrence outlives the cancelled series');
select is(pg_temp.as_member('e', $$select count(*)::text from public.ride_occurrence_schedules(array(select post_id from public.post_ride_details))$$)
    || '|' || pg_temp.as_member('e', $$select count(*) || ':' || count(series_weekdays) from public.rides_feed()$$),
  '0|1:0', 'a ride left by a cancelled series carries no schedule');

select * from finish();
rollback;
