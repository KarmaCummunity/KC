-- Worlds · ride_saved_routes and ride_route_alerts (D74, D95)
--
-- A member follows a route (from → to, optionally only some weekdays and hours) and is
-- told about each new ride along it. The alert itself is a `notification` outbox event;
-- `ride_route_alerts` is the ledger that keeps it to one alert per follower and ride — or
-- per recurring series — and to ten alerts per follower a day.

create table public.ride_saved_routes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references public.users (id) on delete cascade,
  -- Which rides the member wants to hear about.
  wants              text not null default 'offers' check (wants in ('offers', 'requests')),
  origin_city_id     text references public.cities (city_id),
  origin_street_id   integer,
  origin_junction_id integer references public.road_junctions (junction_id),
  origin_point       extensions.geography(Point, 4326) not null,
  dest_city_id       text references public.cities (city_id),
  dest_street_id     integer,
  dest_junction_id   integer references public.road_junctions (junction_id),
  dest_point         extensions.geography(Point, 4326) not null,
  -- A ride matches when both of its ends lie within this distance of the route's ends.
  radius_km          integer not null default 10 check (radius_km between 1 and 50),
  -- Optional filter, Israel local time: weekday bit set (bit 0 = Sunday) and departure hours.
  weekdays           smallint check (weekdays between 1 and 127),
  time_from          time,
  time_to            time,
  created_at         timestamptz not null default now(),
  constraint ride_saved_routes_origin_fk foreign key (origin_city_id, origin_street_id)
    references public.streets (city_id, street_id),
  constraint ride_saved_routes_dest_fk foreign key (dest_city_id, dest_street_id)
    references public.streets (city_id, street_id),
  constraint ride_saved_routes_hours_chk check ((time_from is null) = (time_to is null)),
  -- A route is saved once per member; also "my routes" and the member foreign key.
  constraint ride_saved_routes_member_route_key unique nulls not distinct (
    user_id, wants, origin_city_id, origin_street_id, origin_junction_id,
    dest_city_id, dest_street_id, dest_junction_id)
);
comment on table public.ride_saved_routes is
  'Routes a member follows to hear about new rides along them (D74). Places are official; positions are derived.';

-- Alert matching: routes that start near the origin or a meeting point of a new ride.
create index ride_saved_routes_origin_gist_idx on public.ride_saved_routes using gist (origin_point);
-- Foreign keys to the place catalogs.
create index ride_saved_routes_origin_place_idx on public.ride_saved_routes (origin_city_id, origin_street_id)
  where origin_city_id is not null;
create index ride_saved_routes_origin_junction_idx on public.ride_saved_routes (origin_junction_id)
  where origin_junction_id is not null;
create index ride_saved_routes_dest_place_idx on public.ride_saved_routes (dest_city_id, dest_street_id)
  where dest_city_id is not null;
create index ride_saved_routes_dest_junction_idx on public.ride_saved_routes (dest_junction_id)
  where dest_junction_id is not null;

-- Both ends must be official places; their positions are written from the catalogs. A
-- member keeps at most ten routes.
create function kc_private.ride_saved_routes_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.origin_point := kc_access.place_point(new.origin_city_id, new.origin_street_id, new.origin_junction_id);
  new.dest_point := kc_access.place_point(new.dest_city_id, new.dest_street_id, new.dest_junction_id);
  if new.origin_point is null or new.dest_point is null then
    raise exception 'ride_place_invalid' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.ride_saved_routes r where r.user_id = new.user_id) >= 10 then
    raise exception 'saved_routes_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
comment on function kc_private.ride_saved_routes_prepare() is
  'BEFORE INSERT OR UPDATE on ride_saved_routes: official places, derived positions, ten routes per member.';

create trigger ride_saved_routes_prepare
  before insert or update on public.ride_saved_routes
  for each row execute function kc_private.ride_saved_routes_prepare();

alter table public.ride_saved_routes enable row level security;
alter table public.ride_saved_routes force row level security;

-- A member's routes are private: read, written and removed by the member alone.
create policy ride_saved_routes_all_owner on public.ride_saved_routes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.ride_saved_routes to authenticated;
grant insert (
  user_id, wants, origin_city_id, origin_street_id, origin_junction_id,
  dest_city_id, dest_street_id, dest_junction_id, radius_km, weekdays, time_from, time_to
) on public.ride_saved_routes to authenticated;
grant update (radius_km, weekdays, time_from, time_to) on public.ride_saved_routes to authenticated;

create table public.ride_route_alerts (
  route_id   uuid not null references public.ride_saved_routes (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  -- Series of the ride, when it is an occurrence of a recurring ride.
  series_id  uuid references public.ride_series (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (route_id, post_id),
  -- A follower hears about a recurring ride once (D103); covers the series foreign key.
  constraint ride_route_alerts_series_member_key unique (series_id, user_id)
);
comment on table public.ride_route_alerts is
  'Ledger of saved-route alerts: one per follower and ride or series, ten per follower a day. Written only by server code.';

-- Daily cap of a follower and "alerts I received"; covers the member foreign key.
create index ride_route_alerts_member_recent_idx on public.ride_route_alerts (user_id, created_at desc);
-- Covers the post foreign key (cascade when a ride is purged).
create index ride_route_alerts_post_idx on public.ride_route_alerts (post_id);

alter table public.ride_route_alerts enable row level security;
alter table public.ride_route_alerts force row level security;

create policy ride_route_alerts_select_self on public.ride_route_alerts
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.ride_route_alerts to authenticated;

-- Alerts the followers of every saved route a newly published ride runs along: the route
-- wants this side (offers or requests), its destination and its origin lie within the
-- route's radius of the ride's destination and of the ride's origin or one of its meeting
-- points, the departure falls on a followed weekday and hour, and the follower could open
-- the ride. One alert per follower; none for a series the follower already heard about,
-- none beyond ten a day (D95). The notification carries the departure so that delivery
-- can decide about quiet hours.
create function kc_private.ride_route_alerts_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.post_ride_details;
  v_local timestamp;
  v_route record;
begin
  select r.* into v_ride from public.post_ride_details r where r.post_id = new.id;
  if not found or v_ride.departs_at <= now() then
    return null;
  end if;
  v_local := v_ride.departs_at at time zone 'Asia/Jerusalem';

  for v_route in
    select distinct on (r.user_id) r.id, r.user_id
      from public.ride_saved_routes r
     where r.user_id <> new.owner_id
       and r.wants = case new.direction when 'offer' then 'offers' else 'requests' end
       and (r.weekdays is null or (r.weekdays & (1 << extract(dow from v_local)::integer)) <> 0)
       and (r.time_from is null or v_local::time between r.time_from and r.time_to)
       and extensions.st_dwithin(r.dest_point, v_ride.dest_point, r.radius_km * 1000)
       and (extensions.st_dwithin(r.origin_point, v_ride.origin_point, r.radius_km * 1000)
            or exists (select 1 from jsonb_array_elements(v_ride.meeting_points) m
                        where extensions.st_dwithin(
                                r.origin_point,
                                extensions.st_setsrid(extensions.st_makepoint((m ->> 'lng')::float8, (m ->> 'lat')::float8), 4326)::extensions.geography,
                                r.radius_km * 1000)))
       and kc_private.post_open_to_member(new, r.user_id)
     order by r.user_id, r.created_at
  loop
    continue when (select count(*) from public.ride_route_alerts a
                    where a.user_id = v_route.user_id and a.created_at >= now() - interval '24 hours') >= 10;
    insert into public.ride_route_alerts (route_id, post_id, user_id, series_id)
    values (v_route.id, new.id, v_route.user_id, v_ride.series_id)
    on conflict do nothing;
    continue when not found;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'ride_route_match', 'recipient_id', v_route.user_id, 'actor_id', new.owner_id,
      'entity', jsonb_build_object('type', 'post', 'id', new.id),
      'data', jsonb_build_object(
        'route_id', v_route.id, 'direction', new.direction, 'departs_at', v_ride.departs_at,
        'series_id', v_ride.series_id,
        'dedupe_key', 'ride_route_match:' || coalesce(v_ride.series_id, new.id) || ':' || v_route.user_id)));
  end loop;
  return null;
end;
$$;
comment on function kc_private.ride_route_alerts_emit() is
  'AFTER UPDATE OF status on posts (a ride is published): saved-route alerts as notification events.';

-- A ride post always has its details before it is published (160_world_post_create.sql),
-- so the route is known at this moment.
create trigger posts_ride_route_alerts
  after update of status on public.posts
  for each row
  when (new.post_type = 'ride' and new.status = 'open' and old.status = 'draft')
  execute function kc_private.ride_route_alerts_emit();
