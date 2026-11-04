-- 0620_g1_handoff_readers_on_posts | G1 step 6a-2 (ADR-006, D-214, issue #1671): the handoff
-- readers read `post_handoffs` (and `posts` for the fields a post carries) instead of
-- `giving_handoffs` / `listings`.
--
-- Every handoff writer writes the record since 0555 / 0558 / 0610; `giving_handoffs` is the derived
-- copy (same `handoff_id`, same columns, `listing_id` in place of `post_id`). This group moves the
-- read-only paths over it:
--   1. get_listing_handoff        (0556)  the caller's handoff on a listing or post
--   2. list_my_giving_handoffs    (0385)  the caller's handoffs; the title is the post's
--   3. list_ride_bookings         (0556)  the driver's bookings; ownership from the ride's post
--   4. list_housing_bookings, list_my_housing_stays (0603)  host and guest lists
--   5. housing_guests_on_night, housing_guest_has_overlap (0602)  night capacity and overlap
--   6. can_view_housing_private_details (0601)  host from the post, guest from the record
--   7. listing_has_active_handoff (0543)  the owner RPCs' guard
--   8. ride_listing_participants  (0517)  driver from the post, passengers from the record
--   9. find_ride_listing_matches  (0392)  only the seats taken; the rest still reads listings (6a-4)
--  10. RLS policy housing_booking_details_participant_read (0602)  participants of the record
-- Each body is the latest definition copied verbatim; every changed line carries a `-- 0620:`
-- note. Names, arguments, return types and grants are unchanged, and listing ids stay in the
-- returned shapes (`listing_id_of_post`), so the app is unaffected. The writers, the triggers on
-- giving_handoffs, the ratings and the sweeps are step 6a-3.
--
-- On existing data the output is the same, except:
--   * time-world event registrations live on post_handoffs only (0563 / 0564). The generic readers
--     (1, 2, 7) skip world 'time' on purpose: events have their own roster and registration RPCs,
--     and the giving handoff actions do not apply to them. The others filter on rides / housing.
--   * a post's title is capped at 80 characters where a listing's is at 120, and a post's city is
--     the listing's city or, when the listing has none, its owner's city: a listing-sourced
--     listing with a longer title or no city shows the post's values (posts gain the listing's
--     own columns in 6a-5). Post-sourced listings (the create form, 0554) carry the post's values.
--   * a listing that never got a post — the v1 rides of origin 'ride_listing' (G44, cleaned up
--     before step 6c) — has no handoff record (writers need a post since 0558), so its handoffs
--     and its driver drop out of these readers.
-- Read-only; no schema change. Numbered above the housing range (0600–0610) because 4–6 and 10
-- are defined there. Idempotent (create or replace; the policy is dropped and created in the
-- same transaction).

begin;

-- ── 1. get_listing_handoff (0556) ─────────────────────────────────────────────────────────────

-- `listing_id` stays in the payload for the app; `post_id` is added (null while the listing has
-- no post yet).
create or replace function public.get_listing_handoff(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_listing_id); -- 0620: the post it closes
  v_h public.post_handoffs%rowtype;                               -- 0620: the record
begin
  select * into v_h
    from public.post_handoffs h                                   -- 0620
   where h.post_id = v_post_id                                    -- 0620
     and h.world_slug <> 'time' -- 0620: event registrations have their own RPCs (0563)
     and (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     and (
       h.status in ('reserved', 'confirmed')
       or (
         h.status = 'handed_over'
         and not exists (
           select 1 from public.giving_handoff_ratings r
            where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
       )
     )
   order by (h.status in ('reserved', 'confirmed')) desc, h.reserved_at desc
   limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'handoff_id', v_h.handoff_id,
    'listing_id', public.listing_id_of_post(v_h.post_id), -- 0620: the derived listing
    'post_id', v_h.post_id,                               -- 0620
    'owner_id', v_h.owner_id,
    'recipient_id', v_h.recipient_id,
    'world_slug', v_h.world_slug,
    'status', v_h.status,
    'pickup_mode', v_h.pickup_mode,
    'pickup_window_start', v_h.pickup_window_start,
    'pickup_window_end', v_h.pickup_window_end,
    'confirm_by', v_h.confirm_by,
    'reserved_at', v_h.reserved_at,
    'confirmed_at', v_h.confirmed_at,
    'seats', v_h.seats,
    'slot_starts_at', v_h.slot_starts_at,
    'slot_ends_at', v_h.slot_ends_at
  );
end;
$$;

revoke all on function public.get_listing_handoff(uuid) from public, anon;
grant execute on function public.get_listing_handoff(uuid) to authenticated;

-- ── 2. list_my_giving_handoffs (0385) ─────────────────────────────────────────────────────────

create or replace function public.list_my_giving_handoffs(p_limit int default 50)
returns table (
  handoff_id uuid,
  listing_id uuid,
  title text,
  world_slug text,
  status text,
  role text,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  reserved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.handoff_id,
    public.listing_id_of_post(h.post_id), -- 0620: the derived listing
    p.title,                              -- 0620: the post's title
    h.world_slug,
    h.status,
    case when h.owner_id = auth.uid() then 'owner' else 'recipient' end as role,
    h.pickup_window_start,
    h.pickup_window_end,
    h.reserved_at
  from public.post_handoffs h                  -- 0620: the record
  join public.posts p on p.post_id = h.post_id -- 0620
  where (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
    and h.status <> 'cancelled'
    and h.world_slug <> 'time' -- 0620: event registrations have their own RPCs (0563)
  order by h.reserved_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_my_giving_handoffs(int) from public;
grant execute on function public.list_my_giving_handoffs(int) to authenticated;

-- ── 3. list_ride_bookings (0556) ──────────────────────────────────────────────────────────────

create or replace function public.list_ride_bookings(p_listing_id uuid)
returns table (
  handoff_id     uuid,
  recipient_id   uuid,
  passenger_name text,
  avatar_url     text,
  seats          int,
  status         text,
  reserved_at    timestamptz,
  confirm_by     timestamptz,
  rated_by_me    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_listing_id); -- 0620: the ride's post
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.posts p                                                          -- 0620
     where p.post_id = v_post_id and p.world_slug = 'rides' and p.owner_id = auth.uid() -- 0620
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
           h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.post_handoffs h -- 0620: the record
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id  -- 0620
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, h.reserved_at;
end;
$$;

revoke all on function public.list_ride_bookings(uuid) from public, anon;
grant execute on function public.list_ride_bookings(uuid) to authenticated;

-- ── 4. list_housing_bookings, list_my_housing_stays (0603) ────────────────────────────────────

-- Every live booking on one offer, for its host, with the guest's trust block (S16, D24 —
-- verification, completed stays and seniority; never ratings) and the check-in / check-out
-- instants the app needs to offer "completed" and "no-show" at the right time.
create or replace function public.list_housing_bookings(p_listing_id uuid)
returns table (
  handoff_id            uuid,
  recipient_id          uuid,
  guest_name            text,
  avatar_url            text,
  guest_verified        boolean,
  guest_completed_stays bigint,
  guest_member_since    timestamptz,
  check_in_date         date,
  check_out_date        date,
  slot_starts_at        timestamptz,
  slot_ends_at          timestamptz,
  adults                smallint,
  minors                smallint,
  message               text,
  status                text,
  reserved_at           timestamptz,
  confirm_by            timestamptz,
  rated_by_me           boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.post_id_of_listing(p_listing_id); -- 0620: the offer's post
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts p                              -- 0620
                  where p.post_id = v_post_id and p.world_slug = 'housing' -- 0620
                    and p.owner_id = auth.uid()) then                      -- 0620
    raise exception 'owner_only' using errcode = '42501';
  end if;

  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url,
           u.verified_at is not null,
           (select count(*) from public.post_handoffs g -- 0620: the record
             where g.recipient_id = h.recipient_id and g.world_slug = 'housing'
               and g.status = 'handed_over'),
           u.created_at,
           d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at,
           d.adults, d.minors, d.message,
           h.status, h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.post_handoffs h -- 0620: the record
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id  -- 0620
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, d.check_in_date, h.reserved_at;
end;
$$;

-- The caller's own stay bookings, newest first, with whether the address is open to them.
create or replace function public.list_my_housing_stays(p_limit int default 50)
returns table (
  handoff_id      uuid,
  listing_id      uuid,
  listing_title   text,
  city_id         text,
  host_id         uuid,
  host_name       text,
  check_in_date   date,
  check_out_date  date,
  slot_starts_at  timestamptz,
  slot_ends_at    timestamptz,
  adults          smallint,
  minors          smallint,
  status          text,
  cancel_reason   text,
  reserved_at     timestamptz,
  confirm_by      timestamptz,
  can_view_address boolean,
  rated_by_me     boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  return query
    select h.handoff_id, li.offer_listing_id, p.title, p.city, h.owner_id, u.display_name, -- 0620
           d.check_in_date, d.check_out_date, h.slot_starts_at, h.slot_ends_at, d.adults, d.minors,
           h.status, h.cancel_reason, h.reserved_at, h.confirm_by,
           public.can_view_housing_private_details(li.offer_listing_id, auth.uid()), -- 0620
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.post_handoffs h -- 0620: the record
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
      join public.posts p on p.post_id = h.post_id -- 0620: title and city from the offer's post
      cross join lateral (select public.listing_id_of_post(h.post_id) as offer_listing_id) li -- 0620
      join public.users u on u.user_id = h.owner_id
     where h.recipient_id = auth.uid() and h.world_slug = 'housing'
     order by h.reserved_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.list_housing_bookings(uuid) from public;
revoke all on function public.list_my_housing_stays(int) from public;
grant execute on function public.list_housing_bookings(uuid) to authenticated;
grant execute on function public.list_my_housing_stays(int) to authenticated;

-- ── 5. housing_guests_on_night, housing_guest_has_overlap (0602) ──────────────────────────────

-- Guests of confirmed or completed bookings on the offer for the night that starts on p_night.
create or replace function public.housing_guests_on_night(p_listing_id uuid, p_night date, p_exclude uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(h.seats), 0)::int
    from public.post_handoffs h -- 0620: the record
    join public.housing_booking_details d on d.handoff_id = h.handoff_id
   where h.post_id = public.post_id_of_listing(p_listing_id) -- 0620: the offer's post
     and h.world_slug = 'housing'
     and h.status in ('confirmed', 'handed_over')
     and h.handoff_id is distinct from p_exclude
     and p_night >= d.check_in_date and p_night < d.check_out_date;
$$;

-- Does the guest already hold a confirmed stay that shares a night with [p_in, p_out)?
create or replace function public.housing_guest_has_overlap(p_guest uuid, p_in date, p_out date, p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.post_handoffs h -- 0620: the record
      join public.housing_booking_details d on d.handoff_id = h.handoff_id
     where h.recipient_id = p_guest
       and h.world_slug = 'housing'
       and h.status = 'confirmed'
       and h.handoff_id is distinct from p_exclude
       and d.check_in_date < p_out and p_in < d.check_out_date
  );
$$;

revoke all on function public.housing_guests_on_night(uuid, date, uuid) from public;
revoke all on function public.housing_guest_has_overlap(uuid, date, date, uuid) from public;
grant execute on function public.housing_guests_on_night(uuid, date, uuid) to service_role;
grant execute on function public.housing_guest_has_overlap(uuid, date, date, uuid) to service_role;

-- ── 6. can_view_housing_private_details (0601) ────────────────────────────────────────────────

create or replace function public.can_view_housing_private_details(p_listing_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and (
    exists (select 1 from public.posts p                                     -- 0620: the host
             where p.post_id = public.post_id_of_listing(p_listing_id) and p.owner_id = p_viewer) -- 0620
    or exists (
      select 1 from public.post_handoffs h                                   -- 0620: the record
       where h.post_id = public.post_id_of_listing(p_listing_id)            -- 0620
         and h.world_slug = 'housing'
         and h.recipient_id = p_viewer
         and h.status in ('confirmed', 'handed_over')
         and now() < coalesce(h.slot_ends_at, h.confirmed_at) + interval '24 hours'
    )
  );
$$;

revoke all on function public.can_view_housing_private_details(uuid, uuid) from public;
grant execute on function public.can_view_housing_private_details(uuid, uuid) to service_role;

-- ── 7. listing_has_active_handoff (0543) ──────────────────────────────────────────────────────

create or replace function public.listing_has_active_handoff(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.post_handoffs h                          -- 0620: the record
     where h.post_id = public.post_id_of_listing(p_listing_id)   -- 0620: the listing's post
       and h.world_slug <> 'time' -- 0620: event registrations never blocked the owner RPCs
       and h.status in ('reserved', 'confirmed')
  );
$$;

revoke all on function public.listing_has_active_handoff(uuid) from public, anon, authenticated;

-- ── 8. ride_listing_participants (0517) ───────────────────────────────────────────────────────

-- The ride's participants: its driver and every approved or completed passenger.
create or replace function public.ride_listing_participants(p_listing_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.owner_id from public.posts p                         -- 0620: the driver owns the post
   where p.post_id = public.post_id_of_listing(p_listing_id)   -- 0620
  union
  select h.recipient_id from public.post_handoffs h             -- 0620: the record
   where h.post_id = public.post_id_of_listing(p_listing_id)   -- 0620
     and h.world_slug = 'rides' and h.status in ('confirmed', 'handed_over');
$$;

revoke all on function public.ride_listing_participants(uuid) from public, anon, authenticated;

-- ── 9. find_ride_listing_matches (0392): the seats taken come from the record ────────────────

create or replace function public.find_ride_listing_matches(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_departs_after timestamptz default now(),
  p_departs_before timestamptz default (now() + interval '7 days'),
  p_radius_km double precision default 15,
  p_limit int default 20
)
returns table (
  listing_id uuid,
  title text,
  direction text,
  seats_left int,
  departs_at timestamptz,
  origin_label text,
  dest_label text,
  distance_m double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with viewer as (
    select auth.uid() as uid
  ),
  params as (
    select
      st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography as origin_g,
      st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography as dest_g,
      greatest(1.0, least(coalesce(p_radius_km, 15), 100)) * 1000.0 as radius_m,
      least(greatest(coalesce(p_limit, 20), 1), 50) as lim
  ),
  booked as (
    select public.listing_id_of_post(h.post_id) as listing_id, -- 0620: the ride's listing
           coalesce(sum(h.seats), 0)::int as seats_taken
      from public.post_handoffs h -- 0620: the record
     where h.world_slug = 'rides'
       and h.status in ('reserved', 'confirmed', 'handed_over')
     group by h.post_id -- 0620
  )
  select
    l.listing_id,
    l.title,
    l.direction,
    greatest(
      0,
      coalesce((l.details->>'seats_available')::int, (l.details->>'passengers')::int, 1)
      - coalesce(b.seats_taken, 0)
    ) as seats_left,
    (l.details->>'departs_at')::timestamptz as departs_at,
    l.details->>'origin_label' as origin_label,
    l.details->>'dest_label' as dest_label,
    (
      st_distance(
        st_setsrid(st_makepoint((l.details->>'origin_lng')::float8, (l.details->>'origin_lat')::float8), 4326)::geography,
        p.origin_g
      )
      + st_distance(
        st_setsrid(st_makepoint((l.details->>'dest_lng')::float8, (l.details->>'dest_lat')::float8), 4326)::geography,
        p.dest_g
      )
    ) / 2.0 as distance_m
  from public.listings l
  cross join params p
  cross join viewer v
  left join booked b on b.listing_id = l.listing_id
  where l.world_slug = 'rides'
    and l.status = 'open'
    and public.is_listing_visible_to(l, v.uid)
    and (l.details->>'departs_at')::timestamptz between p_departs_after and p_departs_before
    and l.details ? 'origin_lat' and l.details ? 'origin_lng'
    and l.details ? 'dest_lat' and l.details ? 'dest_lng'
    and st_dwithin(
      st_setsrid(st_makepoint((l.details->>'origin_lng')::float8, (l.details->>'origin_lat')::float8), 4326)::geography,
      p.origin_g,
      p.radius_m
    )
    and st_dwithin(
      st_setsrid(st_makepoint((l.details->>'dest_lng')::float8, (l.details->>'dest_lat')::float8), 4326)::geography,
      p.dest_g,
      p.radius_m
    )
    and greatest(
      0,
      coalesce((l.details->>'seats_available')::int, (l.details->>'passengers')::int, 1)
      - coalesce(b.seats_taken, 0)
    ) > 0
  order by distance_m asc, departs_at asc
  limit (select lim from params);
$$;

revoke all on function public.find_ride_listing_matches(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, double precision, int
) from public;
grant execute on function public.find_ride_listing_matches(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, double precision, int
) to authenticated;

-- ── 10. RLS housing_booking_details_participant_read (0602): participants of the record ──────

drop policy if exists housing_booking_details_participant_read on public.housing_booking_details;
create policy housing_booking_details_participant_read on public.housing_booking_details
  for select to authenticated
  using (exists (
    select 1 from public.post_handoffs h -- 0620: the record (same handoff_id)
     where h.handoff_id = housing_booking_details.handoff_id
       and (h.owner_id = (select auth.uid()) or h.recipient_id = (select auth.uid()))
  ));

commit;
