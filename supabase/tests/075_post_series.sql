-- Recurring events (FR-POST-024): a series publishes one event per matching day, 30 days
-- ahead and never twice; pausing keeps a registered date, editing leaves it as it was,
-- resuming publishes again; a cancelled date tells its registrants and is never published
-- again; ending the series cancels every upcoming date; a clock change never moves a date.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member: 'ok', the P0001 message, or the SQLSTATE. @a … @c members.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := regexp_replace(p_sql, '@([a-c])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
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

-- One value read as a member, or as the database owner when p_who is null. Reads that follow
-- an action go through this function, so they run after it (a plain subquery may run first).
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  if p_who is not null then
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute p_sql into v_value;
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

-- Creates a series as Alice: every day at p_time (Israel time), two hours, two places.
create function pg_temp.series(p_time time, p_weekdays integer default 127, p_minutes integer default 120,
                               p_zone text default 'Asia/Jerusalem', p_org uuid default null)
returns text
language sql
as $$
  select pg_temp.act('a', format(
    'select public.create_post_series(%L::jsonb, %L::jsonb, %L, %s, %s, null, %L, %L)',
    jsonb_build_object('world_slug', 'time', 'direction', 'offer', 'title', 'weekly', 'city_id', 'c1',
      'kind_id', (select k.id from public.post_kinds k where k.slug = 'event')),
    '{"capacity":2,"counts_volunteer_hours":true}', p_time, p_weekdays, p_minutes, p_zone, p_org));
$$;

-- The dates of the series that are still linked to it.
create function pg_temp.dates()
returns bigint
language sql
as $$ select count(*) from public.post_event_details e where e.series_id is not null $$;

select plan(27);

-- Alice organizes; Bob and Carol register.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('time', 'time', 'time');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values ('time', 'event', 'e', 'e', 'offer');

-- Three hours from now and four, as Israel wall-clock times.
create temp table clock as
select ((now() + interval '3 hours') at time zone 'Asia/Jerusalem')::time as t3,
       ((now() + interval '4 hours') at time zone 'Asia/Jerusalem')::time as t4;

-- ── Creating a series ───────────────────────────────────────────────────────
select is(pg_temp.series('10:00', 0), 'post_series_schedule_invalid', 'a series needs at least one weekday');
select is(pg_temp.series('10:00', 127, 5), 'post_series_schedule_invalid', 'a date lasts at least a quarter of an hour');
select is(pg_temp.series('10:00', 127, 120, 'Mars/Olympus'), 'post_series_schedule_invalid', 'a series names a real time zone');
select is(pg_temp.series('10:00', 127, 120, 'Asia/Jerusalem', gen_random_uuid()), '42501',
  'a series is published only for an organization its owner may act for');
select is(pg_temp.series((select t3 from clock)), 'ok', 'a daily series is created');
select ok((select count(*) between 30 and 31 and bool_and(p.status = 'open' and p.post_type = 'event')
                  and bool_and(e.ends_at = e.starts_at + interval '2 hours') and bool_and(e.capacity = 2)
             from public.post_event_details e join public.posts p on p.id = e.post_id where e.series_id is not null),
  'its dates of the next 30 days are published as events, each with the series capacity');
select is(kc_private.post_series_materialize(), 0, 'materialising again creates nothing');
select is(pg_temp.val('b', $$select count(*) from public.post_series$$) || pg_temp.act('b', $$select public.set_post_series_status(
    (select id from public.post_series), 'paused')$$), '0post_series_not_found', 'a series is its owner''s alone');

-- ── Pause, edit all, resume ─────────────────────────────────────────────────
create temp table kept as
select e.post_id, e.starts_at, e.series_on from public.post_event_details e
 where e.series_id is not null order by e.starts_at desc limit 1;
select is(pg_temp.act('b', format('select public.register_for_event(%L)', (select post_id from kept))), 'ok',
  'a date takes registrations like any event');
select is(pg_temp.act('a', $$select public.set_post_series_status((select id from public.post_series), 'paused')$$)
    || '|' || pg_temp.dates(), 'ok|1', 'pausing removes the dates nobody registered for and keeps the registered one');
select is(pg_temp.act('a', format($$select public.update_post_series((select id from public.post_series), %L, 127, 90)$$,
    (select t4 from clock))) || '|' || pg_temp.dates(), 'ok|1', 'a paused series is edited without publishing');
select is(pg_temp.act('a', $$select public.set_post_series_status((select id from public.post_series), 'active')$$)
    || '|' || pg_temp.val(null, $$select (count(*) >= 30) and bool_or(e.ends_at = e.starts_at + interval '90 minutes')
                 from public.post_event_details e where e.series_id is not null$$), 'ok|true',
  'resuming publishes again, on the new schedule');
select is((select e.starts_at from public.post_event_details e where e.post_id = (select post_id from kept)),
  (select starts_at from kept), 'the registered date keeps its time through the edit');

-- ── Cancelling one date ─────────────────────────────────────────────────────
select is(pg_temp.act('b', format('select public.cancel_post_series_date(%L)', (select post_id from kept))),
  'post_series_not_found', 'only the owner cancels a date');
select is(pg_temp.act('a', format('select public.cancel_post_series_date(%L)', (select post_id from kept)))
    || '|' || pg_temp.val(null, $$select h.status || ':' || h.cancel_reason || '|' || p.status
         from public.post_handoffs h join public.posts p on p.id = h.post_id where p.id = (select post_id from kept)$$),
  'ok|cancelled:post_deleted|deleted_no_recipient', 'the owner cancels a date; its registration ends with it');
select is(pg_temp.told('event_registration_cancelled', 'b'), 1::bigint, 'the registrant of a cancelled date is told');
-- The purge removes the deleted post a week later; the day must stay cancelled.
delete from public.posts p where p.id = (select post_id from kept);
select is(kc_private.post_series_materialize() || '|' || pg_temp.val(null, $$select count(*) from public.post_event_details e
    where e.series_on = (select series_on from kept)$$), '0|0', 'a cancelled date is never published again');

-- ── Ending the series ───────────────────────────────────────────────────────
select is(pg_temp.act('c', format('select public.register_for_event(%L)',
    (select e.post_id from public.post_event_details e where e.series_id is not null order by e.starts_at limit 1))),
  'ok', 'Carol registers for the next date');
select is(pg_temp.act('a', $$select public.set_post_series_status((select id from public.post_series), 'ended')$$)
    || '|' || pg_temp.val(null, $$select count(*) from public.posts p join public.post_event_details e on e.post_id = p.id
                where e.series_id is not null and p.status in ('open', 'paused')$$), 'ok|0',
  'ending the series leaves no upcoming date');
select is((select h.status || ':' || h.cancel_reason from public.post_handoffs h
            where h.recipient_id = '00000000-0000-4000-8000-00000000000c')
    || '|' || pg_temp.told('event_registration_cancelled', 'c'), 'cancelled:post_deleted|1',
  'a registered date is cancelled with the series and its registrant is told');
select is(pg_temp.act('a', $$select public.set_post_series_status((select id from public.post_series), 'active')$$),
  'illegal_transition', 'an ended series is never resumed');
select is(pg_temp.act('a', $$select public.update_post_series((select id from public.post_series), '10:00', 127, 60)$$),
  'post_series_not_found', 'an ended series is not edited');

-- ── The scheduler ends a series past its last day ───────────────────────────
select is(pg_temp.series((select t3 from clock)), 'ok', 'a second series');
update public.post_series s set starts_on = starts_on - 10, ends_on = starts_on - 1 where s.status = 'active';
select is(kc_private.post_series_materialize() || '|' || pg_temp.val(null, $$select string_agg(distinct s.status, ',') from public.post_series s$$),
  '0|ended', 'a series past its last day is ended by the scheduler');

-- ── Clock changes (Israel 2026: forward on 27 March, back on 25 October) ─────
select is(kc_private.series_local_instant('2026-03-27', '02:30', 'Asia/Jerusalem'), '2026-03-27 00:30:00+00'::timestamptz,
  'a time inside the spring gap moves forward by the gap (03:30)');
select is(kc_private.series_local_instant('2026-10-25', '01:30', 'Asia/Jerusalem'), '2026-10-24 22:30:00+00'::timestamptz,
  'a time that occurs twice takes its first instant');
select is(kc_private.series_local_instant('2026-11-01', '01:30', 'America/New_York'), '2026-11-01 05:30:00+00'::timestamptz,
  'the same rule in another time zone');

select * from finish();
rollback;
