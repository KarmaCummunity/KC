-- 0516_ride_saved_routes | Saved routes: follow a route and hear about new rides on it
-- (docs/spec/05_giving_worlds.md §5.3 step 4, D74; approved fill S44 — the urgency rule; gap G48).
--
--   1. ride_saved_routes — a user follows from → to (official places, D71), optionally on some
--      weekdays and hours, for offers (a passenger) or requests (a driver). At most 10 per user.
--   2. ride_route_alerts — one row per person per new ride (their first matching route); delivered once.
--   3. A new published ride queues an alert for every matching route: its origin (or one of its
--      meeting points) and its destination within the route's radius, departure on a followed
--      day and hour (Israel time), the right direction, not the publisher's own route.
--   4. Delivery (S44): at most 10 route alerts per user per day; during the user's quiet hours an
--      alert waits for the window to end — unless the ride departs before the window ends, then
--      it goes out at once. The 10-minute sweep delivers waiting alerts and drops departed rides.

begin;

-- ── 1. Saved routes ─────────────────────────────────────────────────────────
create table if not exists public.ride_saved_routes (
  route_id          uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.users(user_id) on delete cascade,
  wants             text not null default 'offers' check (wants in ('offers', 'requests')),
  origin_place_kind text not null check (origin_place_kind in ('city', 'street', 'junction')),
  origin_place_id   text not null,
  origin_label      text not null,
  origin_lat        double precision not null,
  origin_lng        double precision not null,
  dest_place_kind   text not null check (dest_place_kind in ('city', 'street', 'junction')),
  dest_place_id     text not null,
  dest_label        text not null,
  dest_lat          double precision not null,
  dest_lng          double precision not null,
  radius_km         int not null default 10 check (radius_km between 1 and 50),
  -- Followed weekdays, bit 0 = Sunday … bit 6 = Saturday; null = every day.
  weekdays          smallint check (weekdays between 1 and 127),
  -- Followed departure hours in Israel time; both null = any hour.
  time_from         time,
  time_to           time,
  created_at        timestamptz not null default now(),
  check ((time_from is null) = (time_to is null)),
  unique (user_id, wants, origin_place_kind, origin_place_id, dest_place_kind, dest_place_id)
);

create index if not exists ride_saved_routes_user_idx on public.ride_saved_routes (user_id);

alter table public.ride_saved_routes enable row level security;

drop policy if exists ride_saved_routes_owner on public.ride_saved_routes;
create policy ride_saved_routes_owner
  on public.ride_saved_routes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.ride_saved_routes is
  'Routes a user follows to hear about new rides along them (D74). Places are official and canonical (D71).';

-- Places are resolved from the official catalogs; a user keeps at most 10 routes.
create or replace function public.ride_saved_routes_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_place record;
begin
  select * into v_place from public.ride_place_lookup(new.origin_place_kind, new.origin_place_id);
  if not found then raise exception 'ride_place_invalid' using errcode = '23514'; end if;
  new.origin_label := v_place.label; new.origin_lat := v_place.lat; new.origin_lng := v_place.lng;

  select * into v_place from public.ride_place_lookup(new.dest_place_kind, new.dest_place_id);
  if not found then raise exception 'ride_place_invalid' using errcode = '23514'; end if;
  new.dest_label := v_place.label; new.dest_lat := v_place.lat; new.dest_lng := v_place.lng;

  if tg_op = 'INSERT' and (select count(*) from public.ride_saved_routes where user_id = new.user_id) >= 10 then
    raise exception 'saved_routes_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ride_saved_routes_before_write on public.ride_saved_routes;
create trigger ride_saved_routes_before_write
  before insert or update on public.ride_saved_routes
  for each row execute function public.ride_saved_routes_before_write();

-- ── 2. Alerts ───────────────────────────────────────────────────────────────
create table if not exists public.ride_route_alerts (
  route_id     uuid not null references public.ride_saved_routes(route_id) on delete cascade,
  listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  user_id      uuid not null references public.users(user_id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'capped', 'skipped')),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (route_id, listing_id)
);

create index if not exists ride_route_alerts_pending_idx on public.ride_route_alerts (status) where status = 'pending';

alter table public.ride_route_alerts enable row level security;
-- A user may read their own alerts; only the security-definer functions below write them.
drop policy if exists ride_route_alerts_owner_read on public.ride_route_alerts;
create policy ride_route_alerts_owner_read
  on public.ride_route_alerts for select
  to authenticated
  using (user_id = auth.uid());

-- ── 3. Matching ─────────────────────────────────────────────────────────────
-- True when a point lies within p_km of (lat, lng).
create or replace function public.ride_point_within(
  p_lat double precision, p_lng double precision,
  p_lat2 double precision, p_lng2 double precision, p_km int)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_lat is not null and p_lng is not null and p_lat2 is not null and p_lng2 is not null
     and extensions.ST_DWithin(
           extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
           extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng2, p_lat2), 4326)::extensions.geography,
           p_km * 1000);
$$;

-- Routes that a ride serves (direction, places within radius, weekday and hour), not its owner's.
create or replace function public.ride_matching_routes(p_listing public.listings)
returns setof public.ride_saved_routes
language sql
stable
set search_path = public
as $$
  select r.*
    from public.ride_saved_routes r,
         lateral (select (p_listing.details->>'departs_at')::timestamptz at time zone 'Asia/Jerusalem' as local_departs) t
   where r.user_id <> p_listing.owner_id
     and r.wants = case p_listing.direction when 'give' then 'offers' else 'requests' end
     and (r.weekdays is null or (r.weekdays & (1 << extract(dow from t.local_departs)::int)) <> 0)
     and (r.time_from is null or t.local_departs::time between r.time_from and r.time_to)
     and public.ride_point_within(r.dest_lat, r.dest_lng,
           (p_listing.details->>'dest_lat')::float8, (p_listing.details->>'dest_lng')::float8, r.radius_km)
     and (
       public.ride_point_within(r.origin_lat, r.origin_lng,
         (p_listing.details->>'origin_lat')::float8, (p_listing.details->>'origin_lng')::float8, r.radius_km)
       -- A passenger can also be picked up at one of the ride's meeting points.
       or exists (
         select 1 from jsonb_array_elements(
                  case jsonb_typeof(p_listing.details->'meeting_points')
                    when 'array' then p_listing.details->'meeting_points' else '[]'::jsonb end) m
          where public.ride_point_within(r.origin_lat, r.origin_lng,
                  (m->>'lat')::float8, (m->>'lng')::float8, r.radius_km))
     );
$$;

-- ── 4. Delivery ─────────────────────────────────────────────────────────────
-- When the user's current quiet window ends, or null when they are not in quiet hours now.
-- The user's own window wins; otherwise the platform window (matching_settings).
create or replace function public.ride_quiet_window_end(p_user uuid, p_at timestamptz default now())
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prefs jsonb;
  v_end time;
  v_tz text;
  v_end_at timestamptz;
begin
  if not public.match_in_quiet_hours(p_user, p_at) then return null; end if;
  select u.notification_preferences into v_prefs from public.users u where u.user_id = p_user;
  if coalesce((v_prefs -> 'quietHours' ->> 'enabled')::boolean, false) then
    v_end := (v_prefs -> 'quietHours' ->> 'end')::time;
    v_tz := coalesce(v_prefs -> 'quietHours' ->> 'timezone', 'UTC');
  else
    select s.quiet_end, coalesce(s.quiet_tz, 'Asia/Jerusalem') into v_end, v_tz from public.matching_settings s where s.id;
  end if;
  v_end_at := ((p_at at time zone v_tz)::date + v_end) at time zone v_tz;
  if v_end_at <= p_at then v_end_at := v_end_at + interval '1 day'; end if;
  return v_end_at;
end;
$$;

-- Delivers one alert under the S44 rules; returns its new status ('pending' = still waiting).
create or replace function public.ride_route_alert_deliver(p_route_id uuid, p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.ride_route_alerts;
  v_l public.listings;
  v_departs timestamptz;
  v_quiet_end timestamptz;
  v_status text;
begin
  select * into v_alert from public.ride_route_alerts
   where route_id = p_route_id and listing_id = p_listing_id and status = 'pending' for update skip locked;
  if not found then return null; end if;
  select * into v_l from public.listings where listing_id = p_listing_id;
  v_departs := nullif(v_l.details->>'departs_at', '')::timestamptz;

  if v_l.status <> 'open' or v_departs is null or v_departs <= now() then
    v_status := 'skipped';
  elsif (select count(*) from public.ride_route_alerts a
          where a.user_id = v_alert.user_id and a.status = 'sent'
            and a.delivered_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') >= 10 then
    v_status := 'capped';
  else
    v_quiet_end := public.ride_quiet_window_end(v_alert.user_id);
    -- Quiet hours hold an alert back unless the ride leaves before they end (urgent, S44).
    if v_quiet_end is not null and v_departs >= v_quiet_end then return 'pending'; end if;
    perform public.enqueue_notification(
      v_alert.user_id, 'critical', 'ride_route_match',
      'notifications.rideRouteMatchTitle', 'notifications.rideRouteMatchBody',
      jsonb_build_object(
        'origin', coalesce(v_l.details->>'origin_label', ''),
        'dest', coalesce(v_l.details->>'dest_label', ''),
        'when', to_char(v_departs at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', p_listing_id::text)),
      'ride_route_match:' || v_alert.user_id::text || ':' || p_listing_id::text,
      true);
    v_status := 'sent';
  end if;

  update public.ride_route_alerts set status = v_status, delivered_at = now()
   where route_id = p_route_id and listing_id = p_listing_id;
  return v_status;
end;
$$;

-- A new published ride queues and tries to deliver an alert per matching route.
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
    insert into public.ride_route_alerts (route_id, listing_id, user_id)
    values (r.route_id, new.listing_id, r.user_id)
    on conflict do nothing;
    perform public.ride_route_alert_deliver(r.route_id, new.listing_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists listings_ride_route_alerts on public.listings;
create trigger listings_ride_route_alerts
  after insert on public.listings
  for each row when (new.world_slug = 'rides')
  execute function public.listings_ride_route_alerts();

-- Every 10 minutes: deliver alerts that waited for quiet hours to end.
create or replace function public.ride_route_alerts_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_sent int := 0;
begin
  for a in select route_id, listing_id from public.ride_route_alerts where status = 'pending' order by created_at limit 500 loop
    if public.ride_route_alert_deliver(a.route_id, a.listing_id) = 'sent' then v_sent := v_sent + 1; end if;
  end loop;
  return v_sent;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.ride_saved_routes to authenticated;
grant select on public.ride_route_alerts to authenticated;
revoke all on function public.ride_matching_routes(public.listings) from public, anon, authenticated;
revoke all on function public.ride_quiet_window_end(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.ride_route_alert_deliver(uuid, uuid) from public, anon, authenticated;
revoke all on function public.listings_ride_route_alerts() from public, anon, authenticated;
revoke all on function public.ride_route_alerts_sweep() from public, anon, authenticated;
grant execute on function public.ride_route_alerts_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ride_route_alerts_sweep') then
      perform cron.unschedule('ride_route_alerts_sweep');
    end if;
    perform cron.schedule('ride_route_alerts_sweep', '*/10 * * * *', $sql$ select public.ride_route_alerts_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — ride_route_alerts_sweep not scheduled.';
  end if;
end $$;

commit;
