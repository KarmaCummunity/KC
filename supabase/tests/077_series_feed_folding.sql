-- One date of a series in the feed (FR-POST-024 AC11, FR-RIDE-046 AC7): a recurring event or
-- ride is one card in the feed, a world feed and search — its soonest open date; the next
-- date steps in when that one is cancelled, ends or moves; it keeps the series' place in the
-- feed and takes a new one at most once in 7 days; a date that leaves its series is an
-- ordinary post again; the nightly job repairs a series that is off.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member: 'ok', the P0001 message, or the SQLSTATE. @a, @b members.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := regexp_replace(p_sql, '@([a-b])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
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

-- How many cards of a world Bob gets from a feed page with the given filters.
create function pg_temp.cards(p_world text, p_filters text default '{}')
returns text
language sql
as $$
  select pg_temp.val('b', format(
    'select count(*) from public.feed_page(null, 100, %L) f where (f.card).world_slug = %L', p_filters, p_world));
$$;

-- The event dates of the series, soonest first, as "open and unfolded" marks: 1 = in the feed.
create function pg_temp.shown()
returns text
language sql
as $$
  select pg_temp.val(null, $q$
    select string_agg(case when p.status = 'open' and not p.feed_folded then '1' else '0' end, '' order by e.starts_at)
      from public.post_event_details e join public.posts p on p.id = e.post_id
     where e.series_id is not null and p.status = 'open'$q$);
$$;

-- The post id of the n-th open event date of the series, soonest first.
create function pg_temp.nth(p_n integer)
returns uuid
language sql
as $$
  select e.post_id from public.post_event_details e join public.posts p on p.id = e.post_id
   where e.series_id is not null and p.status = 'open'
   order by e.starts_at offset p_n - 1 limit 1;
$$;

select plan(17);

-- Alice publishes; Bob reads the feed.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(35.21 31.77)');
insert into public.worlds (slug, label_he, label_en, shows_in_main_feed) values
  ('time', 'time', 'time', true), ('rides', 'rides', 'rides', true);
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('time', 'event', 'e', 'e', 'offer'), ('rides', 'ride_offer', 'r', 'r', 'offer');

-- ── A recurring event is one card ───────────────────────────────────────────
select is(pg_temp.act('a', format(
    'select public.create_post_series(%L::jsonb, %L::jsonb, %L, 127, 120)',
    jsonb_build_object('world_slug', 'time', 'direction', 'offer', 'title', 'garden day', 'city_id', 'c1',
      'kind_id', (select k.id from public.post_kinds k where k.slug = 'event')),
    '{"capacity":5}', ((now() + interval '3 hours') at time zone 'Asia/Jerusalem')::time)), 'ok',
  'a daily event series is created');
select ok(pg_temp.shown() ~ '^10{29,30}$', 'only its soonest date is unfolded');
select is(pg_temp.cards('time') || '|' || pg_temp.cards('time', '{"world":"time"}')
    || '|' || pg_temp.cards('time', '{"scope":"search","q":"garden"}'), '1|1|1',
  'the series is one card in the main feed, the world feed and search');

-- ── The next date steps in and keeps the series' place ──────────────────────
-- The series took its place two days ago.
update public.posts p set published_at = now() - interval '2 days' where p.id = pg_temp.nth(1);
create temp table second_date as select pg_temp.nth(2) as post_id;
select is(pg_temp.act('a', format('select public.cancel_post_series_date(%L)', pg_temp.nth(1)))
    || '|' || pg_temp.val(null, $$select (not p.feed_folded and p.published_at = now() - interval '2 days')
         from public.posts p where p.id = (select post_id from second_date)$$), 'ok|true',
  'when the date in the feed is cancelled the next one steps in, at the same place');
select ok(pg_temp.shown() ~ '^10+$' and pg_temp.cards('time') = '1', 'still one card');

-- The place is now eight days old: the next date to step in is published anew.
update public.posts p set published_at = now() - interval '8 days'
 where p.id in (select e.post_id from public.post_event_details e where e.series_id is not null) and not p.feed_folded;
create temp table third_date as select pg_temp.nth(2) as post_id;
-- The date in the feed ends: the expiry sweep closes it.
update public.posts p set expires_at = now() - interval '1 minute' where p.id = pg_temp.nth(1);
select ok(kc_private.post_expiry_sweep() >= 1, 'the sweep closes the date that ended');
select is(pg_temp.val(null, $$select (not p.feed_folded and p.published_at = now())
    from public.posts p where p.id = (select post_id from third_date)$$), 'true',
  'after a week the date that steps in is published anew');
select ok(pg_temp.shown() ~ '^10+$', 'and it is the only one unfolded');

-- ── A date that moves, and a date that leaves the series ────────────────────
create temp table last_date as
select e.post_id from public.post_event_details e join public.posts p on p.id = e.post_id
 where e.series_id is not null and p.status = 'open' order by e.starts_at desc limit 1;
update public.post_event_details e
   set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours'
 where e.post_id = (select post_id from last_date);
select is(pg_temp.val(null, $$select pg_temp.nth(1) = (select post_id from last_date)$$) || '|' || (pg_temp.shown() ~ '^10+$'),
  'true|true', 'a date moved to be the soonest takes the place; the one before it is folded');

create temp table loose as select pg_temp.nth(5) as post_id;
update public.post_event_details e set series_id = null, series_on = null where e.post_id = (select post_id from loose);
select is(pg_temp.val(null, $$select not p.feed_folded from public.posts p where p.id = (select post_id from loose)$$)
    || '|' || pg_temp.cards('time'), 'true|2', 'a date that left its series is an ordinary post again');

-- ── Pausing a date, and the nightly repair ──────────────────────────────────
select is(pg_temp.val(null, format($$select kc_private.post_move(%L, 'paused', 'owner')$$, pg_temp.nth(1)))
    is not null and pg_temp.shown() ~ '^10+$', true, 'pausing the date in the feed lets the next one step in');
update public.posts p set feed_folded = false
 where p.id in (select e.post_id from public.post_event_details e where e.series_id is not null);
select ok(pg_temp.shown() ~ '^1+$', 'a series is knocked off: every date unfolded');
select ok(kc_private.series_refold_all() >= 1 and pg_temp.shown() ~ '^10+$', 'the nightly job folds it again');
select is((select count(*) from kc_private.scheduled_jobs j where j.name = 'series_feed_refold'), 1::bigint,
  'the repair is a registered job');

-- ── Ending the series leaves no card; a recurring ride is one card too ──────
select is(pg_temp.act('a', $$select public.set_post_series_status((select id from public.post_series), 'ended')$$)
    || '|' || pg_temp.cards('time'), 'ok|1', 'an ended series leaves the feed; the loose date stays');

select is(pg_temp.act('a', $$select public.accept_world_consent('driver_declaration', 1)$$)
    || pg_temp.act('a', format($$select public.create_ride_series(%L::jsonb, '{"origin_city_id":"c1","dest_city_id":"c2","seats":3}',
    %L, 127, 60)$$, jsonb_build_object('world_slug', 'rides', 'direction', 'offer', 'title', 'daily ride', 'city_id', 'c1',
      'kind_id', (select k.id from public.post_kinds k where k.slug = 'ride_offer')),
    ((now() + interval '3 hours') at time zone 'Asia/Jerusalem')::time)), 'okok', 'a daily ride series is created');
select is(pg_temp.val(null, $$select count(*) filter (where not p.feed_folded) || '|' || (count(*) >= 30)
      || '|' || bool_and(p.feed_folded = (r.departs_at > (select min(r2.departs_at) from public.post_ride_details r2
                                                             where r2.series_id is not null)))
    from public.post_ride_details r join public.posts p on p.id = r.post_id where r.series_id is not null$$)
    || '|' || pg_temp.cards('rides'), '1|true|true|1', 'only its soonest ride is in the feed');

select * from finish();
rollback;
