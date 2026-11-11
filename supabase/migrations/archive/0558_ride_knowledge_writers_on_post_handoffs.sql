-- 0558_ride_knowledge_writers_on_post_handoffs.sql | G1 step 3b″ (ADR-006, D19, D-217): the ride
-- and knowledge booking writers write `post_handoffs`, the handoff record.
--
-- Step 3a (0555) moved the items and food handoffs to the record. Step 3b (0556) found that the
-- ride and knowledge bookings could not follow, because a later occurrence of a recurring ride and
-- an unshared knowledge offer had no post; step 3b-pre (0557) gave every published open listing a
-- post (hidden from the feed where it must be). This step moves the remaining booking writers:
--
--   * rides — `book_ride_seat`, `confirm_ride_booking`, `decline_ride_booking`,
--     `cancel_ride_booking`, `complete_ride_trip`, `complete_ride_listing`,
--     `ride_bookings_expire_sweep`; seat capacity is counted on the record;
--   * knowledge — `book_knowledge_slot`, `complete_knowledge_session`; slots counted on the record.
--
-- The derived `giving_handoffs` row (0555, same `handoff_id`) keeps the ride notifications (0511),
-- the cancel-reason default, the hourly write cap, the ratings FK and every reader working, and the
-- RPCs still return it. Signatures, returned rows and error codes are unchanged; the booking RPCs
-- keep accepting a post id or a listing id (0556).
--
-- Left as they are on purpose: the readers (they read the derived row, which is identical), the
-- generic `cancel_giving_handoff` and `karma_award_handoff` (0603 redefines both and runs after
-- this file on a fresh database), and the housing bookings (0602 / 0603, their own sub-step).
-- Additive and idempotent.

begin;

-- ── 1. Every live handoff has its record ──────────────────────────────────────────────────────

-- A handoff whose listing had no post yet (a knowledge offer that was never shared and has since
-- closed or expired) has no record. Give such listings a hidden post: the upsert copies their
-- handoffs into `post_handoffs` (0553), so the writers below find every live handoff.
do $$
declare
  l public.listings;
  v_n int := 0;
begin
  for l in
    select li.* from public.listings li
     where li.origin = 'native'
       and li.legacy_post_id is null
       and public.post_id_of_listing(li.listing_id) is null
       and exists (
             select 1 from public.giving_handoffs h
              where h.listing_id = li.listing_id and h.status in ('reserved', 'confirmed'))
     order by li.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(l, true);
      v_n := v_n + 1;
    exception when others then
      raise warning '0558 backfill: listing % skipped: % (%)', l.listing_id, sqlerrm, sqlstate;
    end;
  end loop;
  raise notice '0558: % listing(s) with a live handoff received a hidden post', v_n;
end $$;

-- ── 2. Seats taken on a post's handoffs ───────────────────────────────────────────────────────

-- Seats held by the live and completed handoffs of a post, optionally excluding one handoff
-- (the capacity picture a ride booking or approval checks against).
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

-- ── 3. Rides: book → confirm / decline → cancel → complete (0393, 0511, 0530, 0533, 0556) ─────

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
  -- The app reads the derived row (listing_id included) until the one detail screen lands.
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
  -- The side that cancelled, stated on the record (the 0511 default derived it from auth.uid()).
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
  -- the listing through post_sync_from_listing / the mirror sync (0554).
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

comment on function public.ride_bookings_expire_sweep() is
  'Every 10 min: ride bookings the driver did not approve by confirm_by expire on the record and free their seats (S45, 0558).';

revoke all on function public.ride_bookings_expire_sweep() from public, anon, authenticated;
grant execute on function public.ride_bookings_expire_sweep() to service_role;

-- ── 4. Knowledge: book a slot → complete the session (0396, 0453, 0556) ───────────────────────

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

commit;
