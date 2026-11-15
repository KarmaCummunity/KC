-- Worlds · post_ride_details (the ride behind a post of type `ride`, D70)
--
-- One row per ride offer or ride request: the two ends of the route as official places
-- (D71), up to three meeting points, the schedule, seats and the cost model. Created with
-- its post by public.create_post_with_details; the owner edits it while the post is
-- editable. Positions, the cost cap and the post's expiry are derived here, never taken
-- from a device. Private house numbers of the two ends live in post_private_locations.

create table public.post_ride_details (
  post_id            uuid primary key references public.posts (id) on delete cascade,
  -- Each end is a road junction, a city, or a street of a city (D71).
  origin_city_id     text references public.cities (city_id),
  origin_street_id   integer,
  origin_junction_id integer references public.road_junctions (junction_id),
  -- Derived from the place by trigger; what route search and alerts measure against.
  origin_point       extensions.geography(Point, 4326) not null,
  dest_city_id       text references public.cities (city_id),
  dest_street_id     integer,
  dest_junction_id   integer references public.road_junctions (junction_id),
  dest_point         extensions.geography(Point, 4326) not null,
  -- Official places along the way, in order: [{city_id, street_id, junction_id, lat, lng}].
  -- The device sends the ids; positions are written by trigger.
  meeting_points     jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(meeting_points) = 'array' and jsonb_array_length(meeting_points) <= 3),
  departs_at         timestamptz not null,
  -- Estimated end of the ride; null = not stated.
  arrives_at         timestamptz,
  -- Seats offered by a driver, or passengers travelling on a request.
  seats              smallint not null default 1 check (seats between 1 and 8),
  luggage            boolean not null default false,
  cargo_items        boolean not null default false,
  cargo_food         boolean not null default false,
  -- Cost sharing is symbolic and capped by trigger (spec 5.3 rules); never a profit.
  reward_model       text not null default 'free' check (reward_model in ('free', 'expense_share')),
  cost_share_ils     numeric(6, 2) check (cost_share_ils >= 0),
  notes              text check (char_length(notes) <= 280),
  -- Occurrence of a recurring ride (D103): its series and the day it stands for.
  series_id          uuid references public.ride_series (id) on delete set null,
  series_on          date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint post_ride_details_origin_fk foreign key (origin_city_id, origin_street_id)
    references public.streets (city_id, street_id),
  constraint post_ride_details_dest_fk foreign key (dest_city_id, dest_street_id)
    references public.streets (city_id, street_id),
  constraint post_ride_details_origin_place_chk
    check (num_nonnulls(origin_city_id, origin_junction_id) = 1 and num_nonnulls(origin_street_id, origin_junction_id) <= 1),
  constraint post_ride_details_dest_place_chk
    check (num_nonnulls(dest_city_id, dest_junction_id) = 1 and num_nonnulls(dest_street_id, dest_junction_id) <= 1),
  constraint post_ride_details_arrival_chk check (arrives_at > departs_at),
  constraint post_ride_details_cost_chk check ((reward_model = 'expense_share') = (cost_share_ils is not null)),
  constraint post_ride_details_series_chk check ((series_id is null) or (series_on is not null)),
  -- One occurrence per series and day; also covers the series foreign key.
  constraint post_ride_details_series_day_key unique (series_id, series_on)
);
comment on table public.post_ride_details is
  'Route, schedule, seats and cost model of a ride post. Positions and the post expiry are derived by trigger.';

-- Rides feed: upcoming rides by departure (keyset on departs_at, post_id).
create index post_ride_details_departs_idx on public.post_ride_details (departs_at, post_id);
-- Route search and saved-route alerts: rides that start / end near a point.
create index post_ride_details_origin_gist_idx on public.post_ride_details using gist (origin_point);
create index post_ride_details_dest_gist_idx on public.post_ride_details using gist (dest_point);
-- Foreign keys to the place catalogs (a catalog refresh retiring a place).
create index post_ride_details_origin_place_idx on public.post_ride_details (origin_city_id, origin_street_id)
  where origin_city_id is not null;
create index post_ride_details_origin_junction_idx on public.post_ride_details (origin_junction_id)
  where origin_junction_id is not null;
create index post_ride_details_dest_place_idx on public.post_ride_details (dest_city_id, dest_street_id)
  where dest_city_id is not null;
create index post_ride_details_dest_junction_idx on public.post_ride_details (dest_junction_id)
  where dest_junction_id is not null;

-- Everything the server decides about a ride on every write:
--   places     both ends and every meeting point must be official places; their positions
--              are (re)written from the catalogs (ride_place_invalid)
--   schedule   a new or moved departure lies in the future and the estimated end after
--              it (ride_time_invalid)
--   cost       an expense share is at most 20 ILS inside one city and 70 ILS between
--              cities (ride_cost_share_cap_exceeded)
--   driver     an offer needs the owner's current driver declaration (declaration_required)
--   seats      never fewer than the seats already booked (ride_seats_below_bookings)
--   post       its time window, and its expiry: an offer 30 minutes after the estimated
--              end (or the departure), an occurrence of a recurring request at departure,
--              a one-off request never (D21)
create function kc_private.post_ride_details_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_for_details(new.post_id, 'ride');
  v_invalid boolean;
begin
  new.origin_point := kc_access.place_point(new.origin_city_id, new.origin_street_id, new.origin_junction_id);
  new.dest_point := kc_access.place_point(new.dest_city_id, new.dest_street_id, new.dest_junction_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'city_id', m.city_id, 'street_id', m.street_id, 'junction_id', m.junction_id,
           'lat', extensions.st_y(g.point::extensions.geometry),
           'lng', extensions.st_x(g.point::extensions.geometry)) order by e.ordinal), '[]'::jsonb),
         coalesce(bool_or(g.point is null), false)
    into new.meeting_points, v_invalid
    from jsonb_array_elements(new.meeting_points) with ordinality as e (place, ordinal)
   cross join lateral jsonb_to_record(e.place) as m (city_id text, street_id integer, junction_id integer)
   cross join lateral (select kc_access.place_point(m.city_id, m.street_id, m.junction_id) as point) g;
  if v_invalid or new.origin_point is null or new.dest_point is null then
    raise exception 'ride_place_invalid' using errcode = 'P0001';
  end if;

  if ((tg_op = 'INSERT' or new.departs_at <> old.departs_at) and new.departs_at <= now())
     or new.arrives_at <= new.departs_at then
    raise exception 'ride_time_invalid' using errcode = 'P0001';
  end if;
  if new.cost_share_ils > (case when new.origin_city_id = new.dest_city_id then 20 else 70 end) then
    raise exception 'ride_cost_share_cap_exceeded' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and v_post.direction = 'offer'
     and not kc_private.world_consent_accepted(v_post.owner_id, 'driver_declaration') then
    raise exception 'declaration_required' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.seats < old.seats
     and kc_private.handoff_seats_taken(new.post_id) > new.seats then
    raise exception 'ride_seats_below_bookings' using errcode = 'P0001';
  end if;

  update public.posts p
     set time_window = tstzrange(new.departs_at, new.arrives_at),
         expires_at = case
           when v_post.direction = 'offer' then coalesce(new.arrives_at, new.departs_at) + interval '30 minutes'
           when new.series_id is not null then new.departs_at
         end
   where p.id = new.post_id;
  return new;
end;
$$;
comment on function kc_private.post_ride_details_prepare() is
  'BEFORE INSERT OR UPDATE on post_ride_details: official places and positions, schedule, cost cap, driver declaration, seats, post expiry.';

create trigger post_ride_details_prepare
  before insert or update on public.post_ride_details
  for each row execute function kc_private.post_ride_details_prepare();

create trigger post_ride_details_set_updated_at
  before update on public.post_ride_details
  for each row execute function kc_private.set_updated_at();

alter table public.post_ride_details enable row level security;
alter table public.post_ride_details force row level security;

-- A ride's details are visible exactly when its post is: the subquery runs under the
-- caller's own access to `posts`.
create policy post_ride_details_select_visible on public.post_ride_details
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_ride_details.post_id));

-- The owner edits the ride while the post's content is editable (draft, open, paused).
create policy post_ride_details_update_owner on public.post_ride_details
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_ride_details.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')))
  with check (exists (select 1 from public.posts p
                       where p.id = post_ride_details.post_id and p.owner_id = (select auth.uid())));

grant select on public.post_ride_details to authenticated;
-- Not writable: the post, the derived positions and the series link. No insert or delete:
-- the row is created with its post and leaves with it.
grant update (
  origin_city_id, origin_street_id, origin_junction_id, dest_city_id, dest_street_id, dest_junction_id,
  meeting_points, departs_at, arrives_at, seats, luggage, cargo_items, cargo_food,
  reward_model, cost_share_ils, notes
) on public.post_ride_details to authenticated;
