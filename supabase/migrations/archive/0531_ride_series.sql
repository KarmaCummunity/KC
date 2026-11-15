-- 0531_ride_series | Recurring rides: one series, one ride listing per upcoming occurrence
-- (docs/spec/05_giving_worlds.md §5.3 step 1 "recurring ride", FR-RIDE-046; issue #1413).
--
--   1. ride_series — a member's standing ride: direction, the ride details every occurrence
--      starts from (route, seats, cost…), departure time (Israel time), weekdays, optional
--      end date, status active / paused / cancelled. Owner-only RLS; writes go through RPCs.
--   2. An occurrence is an ordinary ride listing carrying details.ride_series =
--      {id, on, weekdays, time}; one per series and day (partial unique index). The feed,
--      search, matching, bookings, saved-route alerts and the emergency button need no change.
--   3. ride_series_materialize — creates the missing occurrences for the next 30 days, so a
--      passenger finds a daily driver for next week too. It runs on create / resume / schedule
--      change and every 10 minutes from ride_series_sweep, which also expires departed request
--      occurrences and hands the main-feed mirror on.
--   4. Noise control: only the soonest upcoming occurrence of a series is mirrored into the
--      main feed (listings_feed_mirror_sync skips the others; the sweep mirrors the next one
--      once it is the soonest); the rides feed shows every occurrence of today and tomorrow and
--      folds the later ones of a series into one row with a count; a saved-route follower is
--      alerted once per series. list_ride_series_occurrences lists a series' upcoming dates.
--   5. RPCs (authenticated): create_ride_series, update_ride_series, set_ride_series_status.
--      Pausing or cancelling removes the upcoming occurrences nobody booked; a booked
--      occurrence is an agreed ride and stays. Cancelling also detaches the booked ones.

begin;

-- ── 1. The series ────────────────────────────────────────────────────────────
create table if not exists public.ride_series (
  series_id        uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users(user_id) on delete cascade,
  kind_id          uuid not null references public.listing_kinds(kind_id),
  direction        text not null check (direction in ('give', 'request')),
  title            text not null check (char_length(title) between 1 and 120),
  summary          text check (summary is null or char_length(summary) <= 500),
  -- The ride details every occurrence starts from (route, seats, cost…), never the times.
  details          jsonb not null default '{}'::jsonb,
  -- Departure in Israel time; weekdays bit 0 = Sunday … bit 6 = Saturday.
  depart_time      time not null,
  weekdays         smallint not null check (weekdays between 1 and 127),
  -- Estimated ride length: an occurrence's arrives_at = departs_at + this. Null = no estimate.
  duration_minutes int check (duration_minutes between 1 and 1440),
  starts_on        date not null default (now() at time zone 'Asia/Jerusalem')::date,
  ends_on          date,
  status           text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ride_series_ends_after_start check (ends_on is null or ends_on >= starts_on)
);

create index if not exists ride_series_owner_idx on public.ride_series (owner_id, created_at);
create index if not exists ride_series_active_idx on public.ride_series (status) where status = 'active';

alter table public.ride_series enable row level security;

drop policy if exists ride_series_owner_select on public.ride_series;
create policy ride_series_owner_select
  on public.ride_series for select
  to authenticated
  using (owner_id = auth.uid());

drop trigger if exists ride_series_set_updated_at on public.ride_series;
create trigger ride_series_set_updated_at
  before update on public.ride_series
  for each row execute function public.set_updated_at();

comment on table public.ride_series is
  'A recurring ride (FR-RIDE-046): the template of its occurrences, departure time (Israel), weekdays, optional end date. Occurrences are ride listings with details.ride_series.';

-- ── 2. Occurrences are ride listings marked with their series and day ────────
-- One occurrence per series and day; concurrent materializer runs cannot duplicate one.
create unique index if not exists listings_ride_series_occurrence_uidx
  on public.listings ((details -> 'ride_series' ->> 'id'), (details -> 'ride_series' ->> 'on'))
  where details ? 'ride_series';

update public.listing_kinds
   set detail_schema = jsonb_set(
         detail_schema, '{properties}',
         (detail_schema -> 'properties') || '{
           "ride_series": {
             "type": "object",
             "additionalProperties": false,
             "required": ["id", "on", "weekdays", "time"],
             "properties": {
               "id": {"type": "string", "format": "uuid"},
               "on": {"type": "string", "format": "date"},
               "weekdays": {"type": "integer", "minimum": 1, "maximum": 127},
               "time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"}
             }
           }
         }'::jsonb)
 where world_slug = 'rides' and slug in ('ride_offer', 'ride_request');

-- The marker an occurrence carries; the app shows "every Sun–Thu at 07:30" from it alone.
create or replace function public.ride_series_marker(p_series public.ride_series, p_on date)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_series.series_id,
    'on', to_char(p_on, 'YYYY-MM-DD'),
    'weekdays', p_series.weekdays,
    'time', to_char(p_series.depart_time, 'HH24:MI'));
$$;

-- ── 3. Materializer ──────────────────────────────────────────────────────────
-- Inserts the occurrence of one series on one day unless it exists or already departed.
-- Returns 1 when a listing was created. The listing triggers do the rest: official places,
-- expiry, cost cap, route alerts, feed mirror.
create or replace function public.ride_series_materialize_day(p_series public.ride_series, p_on date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departs timestamptz := (p_on + p_series.depart_time) at time zone 'Asia/Jerusalem';
  v_details jsonb;
begin
  if (p_series.weekdays & (1 << extract(dow from p_on)::int)) = 0 or v_departs <= now() then
    return 0;
  end if;
  if exists (select 1 from public.listings l
              where l.details -> 'ride_series' ->> 'id' = p_series.series_id::text
                and l.details -> 'ride_series' ->> 'on' = to_char(p_on, 'YYYY-MM-DD')) then
    return 0;
  end if;

  v_details := p_series.details
    || jsonb_build_object('departs_at', v_departs, 'ride_series', public.ride_series_marker(p_series, p_on));
  if p_series.duration_minutes is not null then
    v_details := v_details
      || jsonb_build_object('arrives_at', v_departs + make_interval(mins => p_series.duration_minutes));
  end if;

  begin
    insert into public.listings (
      owner_id, world_slug, kind_id, direction, title, summary, details, origin, moderation_status, expires_at
    ) values (
      p_series.owner_id, 'rides', p_series.kind_id, p_series.direction, p_series.title, p_series.summary,
      v_details, 'native', 'published',
      -- A request occurrence leaves the feed once its day has passed (an offer sets its own, 0514).
      v_departs + interval '30 minutes'
    );
  exception when unique_violation then
    return 0; -- a concurrent run created this day first
  end;
  return 1;
end;
$$;

-- Creates the missing occurrences of every active series (or one) for the next 30 days.
create or replace function public.ride_series_materialize(p_series_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ride_series;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_day date;
  v_last date;
  v_count int := 0;
begin
  for s in select * from public.ride_series r
            where r.status = 'active' and (p_series_id is null or r.series_id = p_series_id)
            order by r.created_at, r.series_id
  loop
    v_day := greatest(s.starts_on, v_today);
    v_last := least(coalesce(s.ends_on, v_today + 30), v_today + 30);
    while v_day <= v_last loop
      v_count := v_count + public.ride_series_materialize_day(s, v_day);
      v_day := v_day + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

comment on function public.ride_series_materialize(uuid) is
  'Creates the missing occurrences of active recurring rides for the next 30 days (FR-RIDE-046).';

-- Removes the upcoming occurrences of a series that nobody booked. A booked occurrence is an
-- agreed ride: it stays, and the driver handles it like any single ride.
create or replace function public.ride_series_drop_unbooked(p_series_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.listings l
   where l.details -> 'ride_series' ->> 'id' = p_series_id::text
     and l.status = 'open'
     and (l.details ->> 'departs_at')::timestamptz > now()
     and not exists (select 1 from public.giving_handoffs h
                      where h.listing_id = l.listing_id and h.status <> 'cancelled');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 4. Noise control ─────────────────────────────────────────────────────────
-- True for an occurrence that must wait its turn in the main feed: another upcoming open
-- occurrence of its series departs earlier.
create or replace function public.ride_series_feed_waits(p_listing public.listings)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_listing.details ? 'ride_series'
     and exists (
       select 1 from public.listings o
        where o.details -> 'ride_series' ->> 'id' = p_listing.details -> 'ride_series' ->> 'id'
          and o.listing_id <> p_listing.listing_id
          and o.status = 'open'
          and o.moderation_status = 'published'
          and (o.details ->> 'departs_at')::timestamptz > now()
          and (o.details ->> 'departs_at')::timestamptz < (p_listing.details ->> 'departs_at')::timestamptz);
$$;

-- Same body as 0466 §9 plus the recurring-ride gate before a first mirror.
create or replace function public.listings_feed_mirror_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mirrored boolean;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  select exists (select 1 from public.posts p where p.listing_id = new.listing_id)
    into v_mirrored;

  -- Without a mirror yet, only a published open listing of a mirrored world gets one — and
  -- of a recurring ride only its soonest upcoming occurrence (FR-RIDE-046).
  if not v_mirrored then
    if new.moderation_status <> 'published' or new.status <> 'open' then
      return new;
    end if;
    if not exists (select 1 from public.worlds w where w.slug = new.world_slug and w.feed_mirror) then
      return new;
    end if;
    if public.ride_series_feed_waits(new) then
      return new;
    end if;
  end if;

  begin
    perform public.listing_feed_mirror_upsert(new);
  exception when others then
    raise warning 'listing_feed_mirror: listing % not mirrored: % (%)', new.listing_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

-- Same body as 0516 §3 plus: a recurring ride alerts a follower once, on the first occurrence
-- they hear about, not on every day it is published.
create or replace function public.listings_ride_route_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.world_slug <> 'rides' or new.status <> 'open' or new.moderation_status <> 'published' then
    return new;
  end if;
  -- One alert per person per ride, even when several of their routes match it.
  for r in select distinct on (m.user_id) m.route_id, m.user_id
             from public.ride_matching_routes(new) m order by m.user_id, m.created_at loop
    if new.details ? 'ride_series' and exists (
         select 1 from public.ride_route_alerts a
         join public.listings l on l.listing_id = a.listing_id
        where a.user_id = r.user_id
          and l.details -> 'ride_series' ->> 'id' = new.details -> 'ride_series' ->> 'id') then
      continue;
    end if;
    insert into public.ride_route_alerts (route_id, listing_id, user_id)
    values (r.route_id, new.listing_id, r.user_id)
    on conflict do nothing;
    perform public.ride_route_alert_deliver(r.route_id, new.listing_id);
  end loop;
  return new;
end;
$$;

-- ── 5. Sweep (every 10 minutes) ──────────────────────────────────────────────
-- Materializes the coming week, expires departed request occurrences and mirrors the next
-- occurrence of each series into the main feed once it is the soonest one.
create or replace function public.ride_series_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := public.ride_series_materialize(null);
  v_next public.listings;
begin
  update public.listings
     set status = 'expired', updated_at = now()
   where world_slug = 'rides'
     and direction = 'request'
     and status = 'open'
     and details ? 'ride_series'
     and expires_at is not null
     and expires_at <= now();

  for v_next in
    select distinct on (l.details -> 'ride_series' ->> 'id') l.*
      from public.listings l
      join public.worlds w on w.slug = l.world_slug and w.feed_mirror
     where l.world_slug = 'rides'
       and l.details ? 'ride_series'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and (l.details ->> 'departs_at')::timestamptz > now()
     order by l.details -> 'ride_series' ->> 'id', (l.details ->> 'departs_at')::timestamptz
  loop
    if not exists (select 1 from public.posts p where p.listing_id = v_next.listing_id) then
      begin
        perform public.listing_feed_mirror_upsert(v_next);
      exception when others then
        raise warning 'ride_series_sweep: occurrence % not mirrored: % (%)', v_next.listing_id, sqlerrm, sqlstate;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function public.ride_series_sweep() is
  'Every 10 min: materializes recurring rides, expires departed request occurrences, mirrors the next occurrence into the main feed (FR-RIDE-046).';

-- ── 6. RPCs ──────────────────────────────────────────────────────────────────
-- Shared checks of a schedule; raises with a stable code the app maps to copy.
create or replace function public.ride_series_check_schedule(p_weekdays int, p_duration_minutes int, p_ends_on date)
returns void
language plpgsql
as $$
begin
  if p_weekdays is null or p_weekdays < 1 or p_weekdays > 127 then
    raise exception 'ride_series_weekdays_invalid' using errcode = '23514';
  end if;
  if p_duration_minutes is not null and (p_duration_minutes < 1 or p_duration_minutes > 1440) then
    raise exception 'ride_series_duration_invalid' using errcode = '23514';
  end if;
  if p_ends_on is not null and p_ends_on < (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'ride_series_ends_in_past' using errcode = '23514';
  end if;
end;
$$;

-- Publishes a recurring ride and its first occurrences. Returns the series and the soonest
-- occurrence, which the app opens.
create or replace function public.create_ride_series(
  p_kind_id uuid,
  p_title text,
  p_details jsonb,
  p_direction text,
  p_depart_time time,
  p_weekdays int,
  p_summary text default null,
  p_duration_minutes int default null,
  p_ends_on date default null
)
returns table (series_id uuid, first_listing_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind public.listing_kinds;
  v_dir text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb) - 'departs_at' - 'arrives_at' - 'ride_series';
  v_series_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'member_inactive' using errcode = '42501';
  end if;

  select * into v_kind from public.listing_kinds where kind_id = p_kind_id and is_active;
  if not found or v_kind.world_slug <> 'rides' then
    raise exception 'kind_not_found' using errcode = 'P0002';
  end if;
  v_dir := coalesce(p_direction, case when v_kind.direction = 'either' then 'give' else v_kind.direction end);
  if v_dir not in ('give', 'request') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  if p_depart_time is null then
    raise exception 'ride_time_invalid' using errcode = '23514';
  end if;
  perform public.ride_series_check_schedule(p_weekdays, p_duration_minutes, p_ends_on);
  -- The template is checked as the occurrence it becomes (the schema requires a departure).
  if not public.validate_listing_details(p_kind_id, v_details || jsonb_build_object('departs_at', now())) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  insert into public.ride_series (owner_id, kind_id, direction, title, summary, details,
                                  depart_time, weekdays, duration_minutes, ends_on)
  values (v_uid, p_kind_id, v_dir, p_title, p_summary, v_details,
          p_depart_time, p_weekdays, p_duration_minutes, p_ends_on)
  returning ride_series.series_id into v_series_id;

  if public.ride_series_materialize(v_series_id) = 0 then
    raise exception 'ride_series_no_occurrence' using errcode = '23514';
  end if;

  return query
    select v_series_id,
           (select l.listing_id from public.listings l
             where l.details -> 'ride_series' ->> 'id' = v_series_id::text
             order by (l.details ->> 'departs_at')::timestamptz limit 1);
end;
$$;

-- The caller's own, not yet cancelled series; raises otherwise.
create or replace function public.ride_series_for_update(p_series_id uuid)
returns public.ride_series
language plpgsql
stable
set search_path = public
as $$
declare
  s public.ride_series;
begin
  select * into s from public.ride_series where series_id = p_series_id and owner_id = auth.uid();
  if not found then
    raise exception 'ride_series_not_found' using errcode = 'P0002';
  end if;
  if s.status = 'cancelled' then
    raise exception 'ride_series_cancelled' using errcode = '23514';
  end if;
  return s;
end;
$$;

-- Changes when a series runs. Upcoming occurrences nobody booked are replaced; booked ones keep
-- their agreed time. The route and the offer are not editable: publish a new series (FR-RIDE-046).
create or replace function public.update_ride_series(
  p_series_id uuid,
  p_depart_time time,
  p_weekdays int,
  p_duration_minutes int default null,
  p_ends_on date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ride_series := public.ride_series_for_update(p_series_id);
begin
  if p_depart_time is null then
    raise exception 'ride_time_invalid' using errcode = '23514';
  end if;
  perform public.ride_series_check_schedule(p_weekdays, p_duration_minutes, p_ends_on);

  update public.ride_series
     set depart_time = p_depart_time,
         weekdays = p_weekdays,
         duration_minutes = p_duration_minutes,
         ends_on = p_ends_on
   where series_id = s.series_id;

  perform public.ride_series_drop_unbooked(s.series_id);
  if s.status = 'active' then
    perform public.ride_series_materialize(s.series_id);
  end if;
end;
$$;

-- active ↔ paused; either → cancelled (terminal). Pausing removes the upcoming unbooked
-- occurrences; resuming publishes them again; cancelling also detaches the booked ones, which
-- go on as single rides.
create or replace function public.set_ride_series_status(p_series_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ride_series := public.ride_series_for_update(p_series_id);
begin
  if p_status not in ('active', 'paused', 'cancelled') then
    raise exception 'ride_series_status_invalid' using errcode = '22023';
  end if;
  if p_status = s.status then
    return;
  end if;

  update public.ride_series set status = p_status where series_id = s.series_id;

  if p_status = 'active' then
    perform public.ride_series_materialize(s.series_id);
    return;
  end if;
  perform public.ride_series_drop_unbooked(s.series_id);
  if p_status = 'cancelled' then
    update public.listings
       set details = details - 'ride_series', updated_at = now()
     where details -> 'ride_series' ->> 'id' = s.series_id::text;
  end if;
end;
$$;

-- ── 7. The rides feed says which rides recur ─────────────────────────────────
-- Same rows as 0515 plus `recurrence` (the occurrence's series marker, null on a single ride)
-- and `series_more`. Today's and tomorrow's occurrences are listed one by one; from the day
-- after tomorrow on, a series folds into its earliest remaining occurrence and `series_more`
-- counts the later ones, so a daily driver is one row under "later", not thirty. The return
-- type changes, so the function is re-created; same arguments, older clients ignore the extra
-- columns.
drop function if exists public.list_rides_feed(int); -- migration-safety: allow — re-created below with two more columns, same arguments
create function public.list_rides_feed(p_limit int default 100)
returns table (
  listing_id     uuid,
  direction      text,
  title          text,
  departs_at     timestamptz,
  origin_label   text,
  dest_label     text,
  meeting_points int,
  seats_left     int,
  passengers     int,
  recurrence     jsonb,
  series_more    int
)
language sql
stable
security definer
set search_path = public
as $$
  with upcoming as (
    select l.*,
           (l.details->>'departs_at')::timestamptz as departs,
           l.details->'ride_series'->>'id' as series_id
      from public.listings l
     where l.world_slug = 'rides'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and jsonb_typeof(l.details->'departs_at') = 'string'
       and (l.details->>'departs_at')::timestamptz > now()
       and public.is_listing_visible_to(l, auth.uid())
  ), horizon as (
    -- Midnight starting the day after tomorrow, Israel time.
    select (((now() at time zone 'Asia/Jerusalem')::date + 2)::timestamp) at time zone 'Asia/Jerusalem' as at
  ), keyed as (
    select u.*,
           case when u.series_id is not null and u.departs >= h.at
                then 'series:' || u.series_id else 'listing:' || u.listing_id::text end as fold_key
      from upcoming u, horizon h
  ), folded as (
    select distinct on (k.fold_key)
           k.*, (count(*) over (partition by k.fold_key) - 1)::int as later_count
      from keyed k
     order by k.fold_key, k.departs, k.listing_id
  )
  select f.listing_id,
         f.direction,
         f.title,
         f.departs,
         f.details->>'origin_label',
         f.details->>'dest_label',
         coalesce(jsonb_array_length(case jsonb_typeof(f.details->'meeting_points')
                                       when 'array' then f.details->'meeting_points' end), 0),
         case when f.direction = 'give' then greatest(0,
           coalesce((f.details->>'seats_available')::int, 1)
           - coalesce((select sum(h.seats)::int from public.giving_handoffs h
                        where h.listing_id = f.listing_id
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when f.direction = 'request' then (f.details->>'passengers')::int end,
         f.details->'ride_series',
         f.later_count
    from folded f
   order by f.departs, f.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

comment on function public.list_rides_feed(int) is
  'Rides feed: open ride offers and requests not yet departed, soonest first, with free seats (D75); a recurring ride shows its recurrence and, from the day after tomorrow, folds into one row with the count of later dates (FR-RIDE-046).';

-- The upcoming dates of one recurring ride, for "other dates" on an occurrence: the member
-- picks the day they need and books that occurrence.
create or replace function public.list_ride_series_occurrences(p_series_id uuid, p_limit int default 60)
returns table (
  listing_id uuid,
  departs_at timestamptz,
  seats_left int,
  passengers int
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id,
         (l.details->>'departs_at')::timestamptz,
         case when l.direction = 'give' then greatest(0,
           coalesce((l.details->>'seats_available')::int, 1)
           - coalesce((select sum(h.seats)::int from public.giving_handoffs h
                        where h.listing_id = l.listing_id
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when l.direction = 'request' then (l.details->>'passengers')::int end
    from public.listings l
   where l.details->'ride_series'->>'id' = p_series_id::text
     and l.status = 'open'
     and l.moderation_status = 'published'
     and (l.details->>'departs_at')::timestamptz > now()
     and public.is_listing_visible_to(l, auth.uid())
   order by (l.details->>'departs_at')::timestamptz, l.listing_id
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

comment on function public.list_ride_series_occurrences(uuid, int) is
  'Upcoming open occurrences of a recurring ride the caller may see, soonest first (FR-RIDE-046).';

-- ── 8. Privileges (ADR-002 §2: explicit per function) ────────────────────────
revoke all on function public.list_rides_feed(int) from public;
grant execute on function public.list_rides_feed(int) to anon, authenticated;
revoke all on function public.list_ride_series_occurrences(uuid, int) from public;
grant execute on function public.list_ride_series_occurrences(uuid, int) to anon, authenticated;

revoke all on function public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date) from public, anon;
grant execute on function public.create_ride_series(uuid, text, jsonb, text, time, int, text, int, date) to authenticated;
revoke all on function public.update_ride_series(uuid, time, int, int, date) from public, anon;
grant execute on function public.update_ride_series(uuid, time, int, int, date) to authenticated;
revoke all on function public.set_ride_series_status(uuid, text) from public, anon;
grant execute on function public.set_ride_series_status(uuid, text) to authenticated;

-- Internal: triggers, the RPCs above (they run as the owner) and pg_cron only.
revoke all on function public.ride_series_marker(public.ride_series, date) from public, anon, authenticated;
revoke all on function public.ride_series_materialize_day(public.ride_series, date) from public, anon, authenticated;
revoke all on function public.ride_series_materialize(uuid) from public, anon, authenticated;
revoke all on function public.ride_series_drop_unbooked(uuid) from public, anon, authenticated;
revoke all on function public.ride_series_feed_waits(public.listings) from public, anon, authenticated;
revoke all on function public.ride_series_check_schedule(int, int, date) from public, anon, authenticated;
revoke all on function public.ride_series_for_update(uuid) from public, anon, authenticated;
revoke all on function public.ride_series_sweep() from public, anon, authenticated;
revoke all on function public.listings_feed_mirror_sync() from public, anon, authenticated;
revoke all on function public.listings_ride_route_alerts() from public, anon, authenticated;
grant execute on function public.ride_series_sweep() to service_role;
grant execute on function public.ride_series_materialize(uuid) to service_role;

-- ── 9. Schedule ──────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ride_series_sweep') then
      perform cron.unschedule('ride_series_sweep');
    end if;
    perform cron.schedule('ride_series_sweep', '*/10 * * * *', $sql$ select public.ride_series_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — ride_series_sweep not scheduled.';
  end if;
end $$;

commit;
