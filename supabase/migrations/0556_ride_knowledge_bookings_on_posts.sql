-- 0556_ride_knowledge_bookings_on_posts.sql | G1 step 3b (ADR-006, D19, D-217): the ride and
-- knowledge bookings and the handoff readers run on `post_handoffs`.
--
-- Step 3a (0555) made `post_handoffs` the record of the items and food handoffs and derived the
-- `giving_handoffs` row from it. This step moves the remaining booking flows the app calls:
--
--   * rides — `book_ride_seat`, `confirm_ride_booking`, `decline_ride_booking`,
--     `cancel_ride_booking`, `complete_ride_trip`, `complete_ride_listing` and the
--     `ride_bookings_expire_sweep` write the record; seat capacity is counted on it;
--   * knowledge — `book_knowledge_slot`, `complete_knowledge_session`;
--   * the generic `cancel_giving_handoff` (re-applied on the record over its 0603 body, which
--     keeps the housing guard);
--   * the readers the app calls — `get_listing_handoff`, `list_my_giving_handoffs`,
--     `list_ride_bookings`, `rate_giving_handoff` — read the record, and the ones that take an
--     id accept a post id or a listing id.
--
-- Signatures, returned rows (`giving_handoffs`, still derived under the same id so the ride and
-- housing notification triggers, the write cap and the ratings FK keep working) and error codes
-- are unchanged. The housing bookings (0602 / 0603) keep writing `giving_handoffs` in this step;
-- the 0553 sync copies them to the record, and they move in their own sub-step so the housing
-- lane's in-flight work is not rewritten under it. Additive and idempotent.

begin;

-- ── Seats taken on a post's handoffs ──────────────────────────────────────────────────────────

-- Seats held by the live and completed handoffs of a post, optionally excluding one handoff
-- (the capacity picture a ride approval or booking checks against).
create or replace function public.post_handoff_seats_taken(p_post_id uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(h.seats), 0)::int
    from public.post_handoffs h
   where h.post_id = p_post_id
     and h.status in ('reserved', 'confirmed', 'handed_over')
     and h.handoff_id is distinct from p_exclude;
$$;

comment on function public.post_handoff_seats_taken(uuid, uuid) is
  'G1: seats held by the reserved, confirmed and handed-over handoffs of a post, minus one excluded handoff.';

revoke all on function public.post_handoff_seats_taken(uuid, uuid) from public, anon, authenticated;
grant execute on function public.post_handoff_seats_taken(uuid, uuid) to service_role;

-- ── Rides: book → confirm / decline → cancel → complete (0393, 0511, 0530, 0533, 0453) ────────

create or replace function public.book_ride_seat(
  p_listing_id uuid,
  p_seats int default 1
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings;
  v_cap int;
  v_departs timestamptz;
  v_seats int := greatest(1, least(coalesce(p_seats, 1), 8));
  v_handoff_id uuid;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  -- The ride's rules still live on the derived listing; its row lock serialises bookings.
  select * into v_l from public.listings
   where listing_id = public.listing_id_of_post(v_post_id) and world_slug = 'rides' and status = 'open'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_l.direction <> 'give' then raise exception 'not_ride_offer' using errcode = '23514'; end if;
  v_departs := nullif(v_l.details->>'departs_at', '')::timestamptz;
  if v_departs <= now() then
    raise exception 'ride_departed' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce((v_l.details->>'seats_available')::int, 1);
  if public.post_handoff_seats_taken(v_post_id) + v_seats > v_cap then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats, confirm_by
  ) values (
    v_post_id, v_l.owner_id, v_uid, 'rides', 'reserved', v_seats,
    least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
  )
  returning handoff_id into v_handoff_id;
  select * into v_row from public.giving_handoffs where handoff_id = v_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.book_ride_seat(uuid, int) from public, anon;
grant execute on function public.book_ride_seat(uuid, int) to authenticated;

create or replace function public.confirm_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_listing public.listings;
  v_cap int;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  -- Lock the ride first, then the booking, as the booking path does (0533).
  select * into v_listing from public.listings
   where listing_id = public.listing_id_of_post(v_h.post_id) and world_slug = 'rides'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  v_cap := coalesce((v_listing.details->>'seats_available')::int, 1);
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.confirm_ride_booking(uuid) from public, anon;
grant execute on function public.confirm_ride_booking(uuid) to authenticated;

create or replace function public.decline_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
   where handoff_id = p_handoff_id;
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.decline_ride_booking(uuid) from public, anon;
grant execute on function public.decline_ride_booking(uuid) to authenticated;

create or replace function public.cancel_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.recipient_id <> v_uid and v_h.owner_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  -- The side that cancelled, stated on the record (the 0511 default did the same from auth.uid()).
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when v_uid = v_h.recipient_id then 'passenger_cancelled' else 'driver_cancelled' end
   where handoff_id = p_handoff_id;
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.cancel_ride_booking(uuid) from public, anon;
grant execute on function public.cancel_ride_booking(uuid) to authenticated;

create or replace function public.complete_ride_trip(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_l public.listings;
  v_departs timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid and v_h.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  select * into v_l from public.listings
   where listing_id = public.listing_id_of_post(v_h.post_id) for update;
  v_departs := nullif(v_l.details->>'departs_at', '')::timestamptz;
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;
  -- The ride closes once no booking is live and every seat has been ridden; the post follows
  -- the listing through post_sync_from_listing (0554).
  if v_l.status = 'open'
     and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status in ('reserved', 'confirmed'))
     and (
       select coalesce(sum(h.seats), 0) from public.post_handoffs h
        where h.post_id = v_h.post_id and h.status = 'handed_over'
     ) >= coalesce((v_l.details->>'seats_available')::int, 1)
  then
    update public.listings set status = 'closed', updated_at = now()
     where listing_id = v_l.listing_id;
  end if;
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.complete_ride_trip(uuid) from public, anon;
grant execute on function public.complete_ride_trip(uuid) to authenticated;

create or replace function public.complete_ride_listing(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_listing public.listings;
  v_departs timestamptz;
  v_completed integer := 0;
  v_h public.post_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_listing from public.listings
   where listing_id = public.listing_id_of_post(v_post_id) and world_slug = 'rides' and direction = 'give'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_listing.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_listing.status <> 'open' then raise exception 'invalid_status' using errcode = '23514'; end if;
  v_departs := nullif(v_listing.details->>'departs_at', '')::timestamptz;
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  for v_h in
    update public.post_handoffs
       set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
     where post_id = v_post_id and world_slug = 'rides' and status = 'confirmed'
     returning *
  loop
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, v_h.handoff_id);
    v_completed := v_completed + 1;
  end loop;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'system'
   where post_id = v_post_id and world_slug = 'rides' and status = 'reserved';
  update public.listings set status = 'closed', updated_at = now()
   where listing_id = v_listing.listing_id;
  return v_completed;
end;
$$;

revoke all on function public.complete_ride_listing(uuid) from public, anon, authenticated;
grant execute on function public.complete_ride_listing(uuid) to authenticated;

create or replace function public.ride_bookings_expire_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'expired'
   where world_slug = 'rides'
     and status = 'reserved'
     and confirm_by < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.ride_bookings_expire_sweep() from public, anon, authenticated;
grant execute on function public.ride_bookings_expire_sweep() to service_role;

-- ── Knowledge: book a slot → complete the session (0396, 0453) ────────────────────────────────

create or replace function public.book_knowledge_slot(p_listing_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings;
  v_cap int;
  v_taken int;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = public.listing_id_of_post(v_post_id) and world_slug = 'knowledge' and status = 'open'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_l.direction <> 'give' then raise exception 'not_offer' using errcode = '23514'; end if;
  v_start := nullif(v_l.details->>'slot_starts_at', '')::timestamptz;
  v_end := nullif(v_l.details->>'slot_ends_at', '')::timestamptz;
  if v_start is not null and v_start <= now() then
    raise exception 'slot_started' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce((v_l.details->>'slots_available')::int, 1);
  select count(*)::int into v_taken
    from public.post_handoffs
   where post_id = v_post_id and world_slug = 'knowledge'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken >= v_cap then raise exception 'slots_exhausted' using errcode = 'P0001'; end if;
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status,
    seats, slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_post_id, v_l.owner_id, v_uid, 'knowledge', 'reserved',
    1, v_start, v_end, now() + interval '24 hours'
  )
  returning handoff_id into v_handoff_id;
  select * into v_row from public.giving_handoffs where handoff_id = v_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.book_knowledge_slot(uuid) from public, anon;
grant execute on function public.book_knowledge_slot(uuid) to authenticated;

create or replace function public.complete_knowledge_session(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'knowledge' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid and v_h.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  if v_h.slot_starts_at is not null and v_h.slot_starts_at > now() + interval '15 minutes' then
    raise exception 'session_not_started' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id;
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.complete_knowledge_session(uuid) from public, anon;
grant execute on function public.complete_knowledge_session(uuid) to authenticated;

-- ── The generic cancel, back on the record (0555 body + the 0603 housing guard) ──────────────

create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
begin
  -- A stay is cancelled through cancel_housing_booking, which applies the housing rules (0603).
  if exists (select 1 from public.post_handoffs
              where handoff_id = p_handoff_id and world_slug = 'housing')
     or exists (select 1 from public.giving_handoffs
                 where handoff_id = p_handoff_id and world_slug = 'housing') then
    raise exception 'housing_use_booking_cancel' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_h.world_slug in ('items', 'food') then
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = public.listing_id_of_post(v_h.post_id) and status = 'open';
  end if;
end;
$$;

revoke all on function public.cancel_giving_handoff(uuid) from public, anon;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;

-- ── Readers (0385, 0399, 0511, 0510) ──────────────────────────────────────────────────────────

-- The caller's live handoff on a post (or the completed one they have not rated yet), by post id
-- or listing id. `listing_id` stays in the payload for the app; `post_id` is added.
create or replace function public.get_listing_handoff(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_h public.post_handoffs;
begin
  select * into v_h
    from public.post_handoffs h
   where h.post_id = v_post_id
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
    'post_id', v_h.post_id,
    'listing_id', public.listing_id_of_post(v_h.post_id),
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
    public.listing_id_of_post(h.post_id) as listing_id,
    p.title,
    h.world_slug,
    h.status,
    case when h.owner_id = auth.uid() then 'owner' else 'recipient' end as role,
    h.pickup_window_start,
    h.pickup_window_end,
    h.reserved_at
  from public.post_handoffs h
  join public.posts p on p.post_id = h.post_id
  where (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
    and h.status <> 'cancelled'
  order by h.reserved_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_my_giving_handoffs(int) from public, anon;
grant execute on function public.list_my_giving_handoffs(int) to authenticated;

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
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.posts p
     where p.post_id = v_post_id and p.world_slug = 'rides' and p.owner_id = auth.uid()
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
           h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.post_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, h.reserved_at;
end;
$$;

revoke all on function public.list_ride_bookings(uuid) from public, anon;
grant execute on function public.list_ride_bookings(uuid) to authenticated;

create or replace function public.rate_giving_handoff(
  p_handoff_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns public.giving_handoff_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_rater uuid := auth.uid();
  v_ratee uuid;
  v_row public.giving_handoff_ratings;
begin
  if v_rater is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating' using errcode = '23514'; end if;
  select * into v_h from public.post_handoffs where handoff_id = p_handoff_id and status = 'handed_over';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_rater = v_h.owner_id then v_ratee := v_h.recipient_id;
  elsif v_rater = v_h.recipient_id then v_ratee := v_h.owner_id;
  else raise exception 'not_participant' using errcode = '42501';
  end if;
  -- The ratings table still keys on the derived giving_handoffs row (same id) until step 6.
  insert into public.giving_handoff_ratings (handoff_id, rater_id, ratee_id, rating, comment)
  values (p_handoff_id, v_rater, v_ratee, p_rating, nullif(trim(p_comment), ''))
  on conflict (handoff_id, rater_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;
  perform public.karma_grant_once(v_rater, 'rating_given', 'giving_handoff_rating', p_handoff_id::text, 2);
  return v_row;
end;
$$;

revoke all on function public.rate_giving_handoff(uuid, smallint, text) from public, anon;
grant execute on function public.rate_giving_handoff(uuid, smallint, text) to authenticated;

commit;
