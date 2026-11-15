-- 0552_ride_post_details | G1 step 1 (ADR-006, D19, BACKLOG G1-S1)
--
-- The ride extension of a post: one row per post of post_type 'ride', holding what the ride
-- listings keep in their `details` JSON today (0391, 0512, 0514, 0517, 0531): the two route
-- ends as official places (D71), up to three meeting points, departure and estimated end, seats
-- or passengers, cargo flags, the cost model (D70) and the recurring-series marker (D103).
-- Filled from the listing by `ride_post_details_upsert`, which `listing_feed_mirror_upsert`
-- (0551) calls on every ride write, and backfilled here for every existing ride mirror.
-- Readable through the post's own visibility; no client writes (RLS at least as strict as the
-- listing detail it copies). Additive and idempotent.

begin;

create table if not exists public.ride_post_details (
  post_id            uuid primary key references public.posts(post_id) on delete cascade,
  origin_place_kind  text check (origin_place_kind is null or origin_place_kind in ('city', 'street', 'junction')),
  origin_place_id    text check (origin_place_id is null or char_length(origin_place_id) <= 64),
  origin_label       text check (origin_label is null or char_length(origin_label) <= 120),
  origin_city_id     text references public.cities(city_id),
  origin_lat         double precision check (origin_lat is null or origin_lat between -90 and 90),
  origin_lng         double precision check (origin_lng is null or origin_lng between -180 and 180),
  dest_place_kind    text check (dest_place_kind is null or dest_place_kind in ('city', 'street', 'junction')),
  dest_place_id      text check (dest_place_id is null or char_length(dest_place_id) <= 64),
  dest_label         text check (dest_label is null or char_length(dest_label) <= 120),
  dest_city_id       text references public.cities(city_id),
  dest_lat           double precision check (dest_lat is null or dest_lat between -90 and 90),
  dest_lng           double precision check (dest_lng is null or dest_lng between -180 and 180),
  -- Official places along the way (D71): [{kind, id, label, lat, lng, city_id}], at most 3.
  meeting_points     jsonb not null default '[]'::jsonb
    check (jsonb_typeof(meeting_points) = 'array' and jsonb_array_length(meeting_points) <= 3),
  departs_at         timestamptz not null,
  arrives_at         timestamptz,
  seats_available    integer check (seats_available is null or seats_available >= 0),
  passengers         integer check (passengers is null or passengers between 1 and 8),
  luggage            boolean,
  cargo_items        boolean,
  cargo_food         boolean,
  reward_model       text check (reward_model is null or reward_model in ('free', 'expense_share')),
  cost_share_ils     numeric check (cost_share_ils is null or cost_share_ils >= 0),
  constraints        text check (constraints is null or char_length(constraints) <= 280),
  series_id          uuid references public.ride_series(series_id) on delete set null,
  series_on          date,
  linked_listing_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.ride_post_details is
  'Ride extension of a post (post_type = ride): route ends and meeting points as official places (D71), schedule, seats, cost model, series marker. One row per ride post (D19, ADR-006).';

create index if not exists ride_post_details_departs_idx on public.ride_post_details (departs_at);
create index if not exists ride_post_details_series_idx on public.ride_post_details (series_id)
  where series_id is not null;

create or replace trigger ride_post_details_set_updated_at
  before update on public.ride_post_details
  for each row execute function public.set_updated_at();

-- ── RLS: a ride's details are visible exactly when its post is; clients never write ──
alter table public.ride_post_details enable row level security;

drop policy if exists ride_post_details_select_visible on public.ride_post_details;
create policy ride_post_details_select_visible on public.ride_post_details
  for select to authenticated
  using (exists (
    select 1 from public.posts p
     where p.post_id = ride_post_details.post_id
       and public.is_post_visible_to(p, (select auth.uid()))
  ));

revoke all on public.ride_post_details from public, anon;
revoke insert, update, delete on public.ride_post_details from authenticated;
grant select on public.ride_post_details to authenticated;

-- ── Upsert from the ride detail JSON a listing (or, later, a post) stores ───────────
-- Casts are strict on purpose: the listing kinds' JSON schema already validates native rides,
-- and the caller (the mirror sync) reports a row it cannot copy instead of hiding it.
create or replace function public.ride_post_details_upsert(p_post_id uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_departs timestamptz := nullif(d ->> 'departs_at', '')::timestamptz;
  v_series_id uuid;
begin
  -- Without a departure there is no ride to describe (the schema requires it).
  if v_departs is null then
    return;
  end if;

  -- A series marker points at a live series only; a stale marker is kept as a date alone.
  select s.series_id into v_series_id
    from public.ride_series s
   where s.series_id::text = d -> 'ride_series' ->> 'id';

  insert into public.ride_post_details as r (
    post_id, origin_place_kind, origin_place_id, origin_label, origin_city_id, origin_lat, origin_lng,
    dest_place_kind, dest_place_id, dest_label, dest_city_id, dest_lat, dest_lng,
    meeting_points, departs_at, arrives_at, seats_available, passengers, luggage,
    cargo_items, cargo_food, reward_model, cost_share_ils, constraints,
    series_id, series_on, linked_listing_id
  ) values (
    p_post_id,
    d ->> 'origin_place_kind', d ->> 'origin_place_id', left(d ->> 'origin_label', 120),
    d ->> 'origin_city_id', (d ->> 'origin_lat')::double precision, (d ->> 'origin_lng')::double precision,
    d ->> 'dest_place_kind', d ->> 'dest_place_id', left(d ->> 'dest_label', 120),
    d ->> 'dest_city_id', (d ->> 'dest_lat')::double precision, (d ->> 'dest_lng')::double precision,
    case when jsonb_typeof(d -> 'meeting_points') = 'array' then d -> 'meeting_points' else '[]'::jsonb end,
    v_departs,
    nullif(d ->> 'arrives_at', '')::timestamptz,
    nullif(d ->> 'seats_available', '')::integer,
    nullif(d ->> 'passengers', '')::integer,
    nullif(d ->> 'luggage', '')::boolean,
    nullif(d ->> 'cargo_items', '')::boolean,
    nullif(d ->> 'cargo_food', '')::boolean,
    d ->> 'reward_model',
    nullif(d ->> 'cost_share_ils', '')::numeric,
    left(d ->> 'constraints', 280),
    v_series_id,
    nullif(d -> 'ride_series' ->> 'on', '')::date,
    nullif(d ->> 'linked_listing_id', '')::uuid
  )
  on conflict (post_id) do update set
    origin_place_kind = excluded.origin_place_kind,
    origin_place_id   = excluded.origin_place_id,
    origin_label      = excluded.origin_label,
    origin_city_id    = excluded.origin_city_id,
    origin_lat        = excluded.origin_lat,
    origin_lng        = excluded.origin_lng,
    dest_place_kind   = excluded.dest_place_kind,
    dest_place_id     = excluded.dest_place_id,
    dest_label        = excluded.dest_label,
    dest_city_id      = excluded.dest_city_id,
    dest_lat          = excluded.dest_lat,
    dest_lng          = excluded.dest_lng,
    meeting_points    = excluded.meeting_points,
    departs_at        = excluded.departs_at,
    arrives_at        = excluded.arrives_at,
    seats_available   = excluded.seats_available,
    passengers        = excluded.passengers,
    luggage           = excluded.luggage,
    cargo_items       = excluded.cargo_items,
    cargo_food        = excluded.cargo_food,
    reward_model      = excluded.reward_model,
    cost_share_ils    = excluded.cost_share_ils,
    constraints       = excluded.constraints,
    series_id         = excluded.series_id,
    series_on         = excluded.series_on,
    linked_listing_id = excluded.linked_listing_id
  where (r.origin_place_kind, r.origin_place_id, r.origin_label, r.origin_city_id, r.origin_lat, r.origin_lng,
         r.dest_place_kind, r.dest_place_id, r.dest_label, r.dest_city_id, r.dest_lat, r.dest_lng,
         r.meeting_points, r.departs_at, r.arrives_at, r.seats_available, r.passengers, r.luggage,
         r.cargo_items, r.cargo_food, r.reward_model, r.cost_share_ils, r.constraints,
         r.series_id, r.series_on, r.linked_listing_id)
        is distinct from
        (excluded.origin_place_kind, excluded.origin_place_id, excluded.origin_label, excluded.origin_city_id,
         excluded.origin_lat, excluded.origin_lng, excluded.dest_place_kind, excluded.dest_place_id,
         excluded.dest_label, excluded.dest_city_id, excluded.dest_lat, excluded.dest_lng,
         excluded.meeting_points, excluded.departs_at, excluded.arrives_at, excluded.seats_available,
         excluded.passengers, excluded.luggage, excluded.cargo_items, excluded.cargo_food,
         excluded.reward_model, excluded.cost_share_ils, excluded.constraints,
         excluded.series_id, excluded.series_on, excluded.linked_listing_id);
end;
$$;

revoke all on function public.ride_post_details_upsert(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ride_post_details_upsert(uuid, jsonb) to service_role;

-- ── Backfill every existing ride mirror; one bad row is reported, not fatal ─────────
do $$
declare
  r record;
begin
  for r in
    select p.post_id, l.details
      from public.posts p
      join public.listings l on l.listing_id = p.listing_id
     where l.world_slug = 'rides'
  loop
    begin
      perform public.ride_post_details_upsert(r.post_id, r.details);
    exception when others then
      raise warning 'ride_post_details backfill: post % skipped: % (%)', r.post_id, sqlerrm, sqlstate;
    end;
  end loop;
end $$;

commit;
