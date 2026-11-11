-- 0622_g1_writer_returns_from_post_handoffs | G1 step 6a-3b (ADR-006, D-214, issue #1671): the
-- handoff writer RPCs build the row they return from `post_handoffs`, the handoff record, instead of
-- reading it back from `giving_handoffs`, the derived copy.
--
-- Every writer writes the record since 0555 / 0558 / 0610, and the readers (0565 / 0620) and the
-- triggers, ratings and foreign keys (0621) moved to it; the writers still ended with
-- `select * into v_row from public.giving_handoffs`. Their signatures and their return type stay
-- `public.giving_handoffs` (the app types the result as that row, `listing_id` included), so only
-- that last read changes:
--   1. giving_handoff_row_of (new)  the giving_handoffs-shaped row of a handoff, from the record:
--      `listing_id` is `listing_id_of_post(post_id)`, every other column is copied 1:1
--   2. items / food: reserve_item_giving, confirm_item_handoff, claim_food_giving (0555),
--      mark_giving_handed_over (0559)
--   3. rides: book_ride_seat, confirm_ride_booking, decline_ride_booking, cancel_ride_booking,
--      complete_ride_trip (0558)
--   4. knowledge: book_knowledge_slot, complete_knowledge_session (0558)
--   5. housing: request_housing_booking (0621), decide_housing_booking, cancel_housing_booking,
--      complete_housing_booking, mark_housing_no_show (0610)
--   6. delete_my_listing (0554): its "handed over before" guard reads the record
-- cancel_giving_handoff (0610) returns nothing and already reads only the record. Each changed body
-- is the latest definition copied verbatim; every changed line carries a `-- 0622:` note; the grants
-- are restated as they are today. The helper is read in its own statement, after the write, so it
-- sees the row the RPC just inserted or updated.
--
-- On existing data the output is the same: the derived row is written by the
-- post_handoffs_giving_sync trigger in the same statement as the record, with the same values.
-- Except, by construction:
--   * a handoff whose post has no listing (`listing_id_of_post` null) returned an empty row, since
--     the sync wrote no derived row and warned (0555); it now returns the record with a null
--     `listing_id`. Every writer above locks the post's listing first, so none reaches it.
--   * a world 'time' handoff (an event registration, 0563 / 0564) has no derived row; the helper
--     returns null for it, as reading giving_handoffs did. Events have their own RPCs, which return
--     the record itself, and never reach these writers.
--   * delete_my_listing skips event registrations, which giving_handoffs never held; a listing that
--     never got a post (the v1 rides of origin 'ride_listing', G44) has no record, so a handed-over
--     handoff of one no longer blocks its delete (as listing_has_active_handoff since 0620).
-- After this file only the two-way sync (0553 / 0555 / 0563) with the write cap still attached to
-- the table (0534), the unification report (0553), the dev demo seed's trigger toggle (0592) and the
-- v1 ride-series functions (0531, step 6a-4) touch giving_handoffs. Numbered above the housing range
-- (0600–0610) because 5 redefines functions defined there and in 0621.
-- Idempotent (create or replace).

begin;

-- ── 1. giving_handoff_row_of ──────────────────────────────────────────────────────────────────

-- The giving_handoffs-shaped row of handoff p_handoff_id, built from the record. Null for an
-- unknown handoff and for an event registration (world 'time', which has no derived row). Called
-- by the writers in a statement after their write; a STABLE function evaluated in the same
-- statement as the insert would not see the new row.
create or replace function public.giving_handoff_row_of(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug <> 'time';
  if not found then
    return null;
  end if;
  -- By name, not by position, so the column order of the two tables does not matter.
  v_row.handoff_id          := v_h.handoff_id;
  v_row.listing_id          := public.listing_id_of_post(v_h.post_id);
  v_row.owner_id            := v_h.owner_id;
  v_row.recipient_id        := v_h.recipient_id;
  v_row.world_slug          := v_h.world_slug;
  v_row.status              := v_h.status;
  v_row.cancel_reason       := v_h.cancel_reason;
  v_row.pickup_mode         := v_h.pickup_mode;
  v_row.pickup_window_start := v_h.pickup_window_start;
  v_row.pickup_window_end   := v_h.pickup_window_end;
  v_row.slot_starts_at      := v_h.slot_starts_at;
  v_row.slot_ends_at        := v_h.slot_ends_at;
  v_row.seats               := v_h.seats;
  v_row.confirm_by          := v_h.confirm_by;
  v_row.reserved_at         := v_h.reserved_at;
  v_row.confirmed_at        := v_h.confirmed_at;
  v_row.handed_over_at      := v_h.handed_over_at;
  v_row.cancelled_at        := v_h.cancelled_at;
  v_row.no_show_at          := v_h.no_show_at;
  return v_row;
end;
$$;

comment on function public.giving_handoff_row_of(uuid) is
  'G1 step 6a-3b: the giving_handoffs-shaped row of a handoff, built from post_handoffs (listing_id via listing_id_of_post); null for an unknown handoff or a time-world registration. Internal: the writer RPCs return it.';

revoke all on function public.giving_handoff_row_of(uuid) from public, anon, authenticated;
grant execute on function public.giving_handoff_row_of(uuid) to service_role;

-- ── 2. Items and food (0555, 0559) ──────────────────────────────────────────────────────────────

create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings%rowtype;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_mode text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  -- The item's rules (world, direction, status, visibility) still live on the derived listing;
  -- its row lock serialises attempts on the same item before the live-handoff check.
  select l.* into v_l
    from public.listings l
   where l.listing_id = public.listing_id_of_post(v_post_id)
     and l.world_slug = 'items'
     and l.direction = 'give'
     and l.status = 'open'
     and public.is_listing_visible_to(l, v_uid)
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed')
       and h.world_slug in ('items', 'food')
  ) then
    raise exception 'item_already_reserved' using errcode = '23514';
  end if;

  v_mode := coalesce(nullif(trim(p_pickup_mode), ''), 'pickup');
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = '23514';
  end if;

  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirm_by
    ) values (
      v_post_id, v_l.owner_id, v_uid, 'items', 'reserved',
      v_mode,
      coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz),
      coalesce(p_pickup_window_end, (v_l.details->>'pickup_window_end')::timestamptz),
      now() + interval '24 hours'
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.listings
     set availability_status = 'scheduled', updated_at = now()
   where listing_id = v_l.listing_id;

  -- The app reads the derived row (listing_id included) until the one detail screen lands.
  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
     and owner_id = auth.uid()
     and status = 'reserved'
     and world_slug = 'items';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.confirm_item_handoff(uuid) from public, anon;
grant execute on function public.confirm_item_handoff(uuid) to authenticated;

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  if v_h.world_slug = 'items'
     and exists (select 1 from public.posts p where p.post_id = v_h.post_id and p.listing_id is null) then
    -- One closing system (G34): the post closure pays giver 20 + value bonus / receiver 15 once.
    perform public.post_close_from_handoff(v_h);
  else
    update public.listings
       set status = 'closed', availability_status = 'ongoing', updated_at = now()
     where listing_id = public.listing_id_of_post(v_h.post_id);
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  end if;

  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.mark_giving_handed_over(uuid) from public, anon;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated;

create or replace function public.claim_food_giving(
  p_listing_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings%rowtype;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = public.listing_id_of_post(v_post_id)
     and world_slug = 'food'
     and direction = 'give'
     and status = 'open'
     and (expires_at is null or expires_at > now());
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  -- A claim goes through the listing's visibility rule, as reserve_item_giving does
  -- (FR-MOD-009 AC1); the refusal is the same as for a missing listing.
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;

  v_start := coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz, now());
  v_end := coalesce(
    p_pickup_window_end,
    (v_l.details->>'pickup_window_end')::timestamptz,
    coalesce(v_l.expires_at, now() + interval '4 hours')
  );

  -- One live claim per offer (post_handoffs_active_post_uidx). The app mapped the old index name
  -- to listing_not_available (@kc/domain mapMarketplaceServerError); the RPC now says so itself.
  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirmed_at
    ) values (
      v_post_id, v_l.owner_id, v_uid, 'food', 'confirmed',
      'pickup', v_start, v_end, now()
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end;

  update public.listings
     set availability_status = 'scheduled', urgency_level = public.food_listing_urgency_level(v_l.expires_at),
         updated_at = now()
   where listing_id = v_l.listing_id;

  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.claim_food_giving(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated;

-- ── 3. Rides (0558) ─────────────────────────────────────────────────────────────────────────────

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
  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
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
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
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
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
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
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
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
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.complete_ride_trip(uuid) from public, anon;
grant execute on function public.complete_ride_trip(uuid) to authenticated;

-- ── 4. Knowledge (0558) ─────────────────────────────────────────────────────────────────────────

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
  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
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
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.complete_knowledge_session(uuid) from public, anon;
grant execute on function public.complete_knowledge_session(uuid) to authenticated;

-- ── 5. Housing (0610, 0621) ─────────────────────────────────────────────────────────────────────

create or replace function public.request_housing_booking(
  p_listing_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults int,
  p_minors int default 0,
  p_message text default null,
  p_minors_guardian_ack boolean default false
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_listing public.listings;
  v_nights int := p_check_out - p_check_in;
  v_party int := coalesce(p_adults, 0) + coalesce(p_minors, 0);
  v_start timestamptz;
  v_handoff_id uuid;
  v_h public.post_handoffs; -- 0621: the record, for the host's push
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  perform public.housing_assert_eligible(v_uid, 'book');

  -- Lock the offer so concurrent requests and approvals see one capacity picture.
  select l.* into v_listing
    from public.listings l
    join public.listing_kinds k on k.kind_id = l.kind_id
   where l.listing_id = public.listing_id_of_post(v_post_id) and l.world_slug = 'housing' and l.status = 'open'
     and k.slug = 'host_offer'
   for update of l;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_listing.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  -- Dates: from today (Israel) up to 180 days ahead, within the offer's night limits.
  if p_check_in is null or p_check_out is null
     or p_check_in < public.housing_today() or p_check_in > public.housing_today() + 180 then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;
  if v_nights < (v_listing.details->>'min_nights')::int or v_nights > (v_listing.details->>'max_nights')::int then
    raise exception 'housing_nights_out_of_range' using errcode = '23514';
  end if;
  -- A same-day request is possible only while the host's check-in window is still open.
  if now() > public.housing_check_in_deadline(v_listing.details, p_check_in) then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;

  -- Party and the host's policy (FR-HOUSING-015 AC2, FR-HOUSING-026).
  if coalesce(p_adults, 0) < 1 or coalesce(p_minors, 0) < 0 or v_party > 8 then
    raise exception 'housing_capacity_exceeded' using errcode = '23514';
  end if;
  if p_minors > 0 and not (v_listing.details->>'children_ok')::boolean then
    raise exception 'housing_policy_mismatch' using errcode = '23514';
  end if;
  if p_minors > 0 and not coalesce(p_minors_guardian_ack, false) then
    raise exception 'housing_minor_unaccompanied' using errcode = '23514';
  end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 500 then
    raise exception 'housing_message_required' using errcode = '23514';
  end if;

  -- One active booking per offer, ≤ 3 waiting requests, no second stay on the same nights.
  if exists (select 1 from public.post_handoffs
              where post_id = v_post_id and recipient_id = v_uid
                and status in ('reserved', 'confirmed')) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  if (select count(*) from public.post_handoffs
       where recipient_id = v_uid and world_slug = 'housing' and status = 'reserved') >= 3 then
    raise exception 'housing_pending_cap' using errcode = '23514';
  end if;
  if public.housing_guest_has_overlap(v_uid, p_check_in, p_check_out, null) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(v_listing, p_check_in, p_check_out, v_party, null);

  v_start := public.housing_check_in_at(v_listing.details, p_check_in);
  -- The record first: its sync derives the giving_handoffs row the details row points at.
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_post_id, v_listing.owner_id, v_uid, 'housing', 'reserved', v_party,
    v_start, public.housing_check_out_at(v_listing.details, p_check_out),
    -- Unanswered requests expire after 24 h or at check-in, whichever is earlier (FR-HOUSING-017).
    least(now() + interval '24 hours', public.housing_check_in_deadline(v_listing.details, p_check_in))
  )
  returning handoff_id into v_handoff_id;

  insert into public.housing_booking_details (
    handoff_id, check_in_date, check_out_date, adults, minors, message, minors_guardian_ack
  ) values (
    v_handoff_id, p_check_in, p_check_out, p_adults, p_minors, btrim(p_message),
    coalesce(p_minors_guardian_ack, false)
  );

  v_row := public.giving_handoff_row_of(v_handoff_id); -- 0622: built from the record
  select * into v_h from public.post_handoffs where handoff_id = v_handoff_id; -- 0621
  -- Told here, after the details exist, so the host's push carries the dates.
  perform public.housing_booking_enqueue(v_h, 'housing_booking_requested', v_h.owner_id, v_uid); -- 0621: the record
  return v_row;
end;
$$;

revoke all on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) from public, anon;
grant execute on function public.request_housing_booking(uuid, date, date, int, int, text, boolean) to authenticated;

create or replace function public.decide_housing_booking(
  p_handoff_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_listing public.listings;
  v_details public.housing_booking_details;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;

  -- Locks follow listing → booking order, like the rides approval (0533).
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  select * into v_listing from public.listings
   where listing_id = public.listing_id_of_post(v_h.post_id) for update;
  select * into v_h from public.post_handoffs where handoff_id = p_handoff_id for update;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;

  if not coalesce(p_approve, false) then
    update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
     where handoff_id = p_handoff_id;
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
     where handoff_id = p_handoff_id;
    v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
    return v_row;
  end if;

  perform public.housing_assert_eligible(v_uid, 'decide');
  perform public.housing_assert_eligible(v_h.recipient_id, 'book');
  if v_listing.status <> 'open' then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  if public.housing_guest_has_overlap(v_h.recipient_id, v_details.check_in_date, v_details.check_out_date, p_handoff_id) then
    raise exception 'housing_booking_overlap' using errcode = '23514';
  end if;
  perform public.housing_assert_nights_bookable(
    v_listing, v_details.check_in_date, v_details.check_out_date, v_h.seats, p_handoff_id);

  update public.housing_booking_details set decision_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id;

  -- First confirmation wins: the guest's other waiting requests for overlapping nights end
  -- (FR-HOUSING-015 AC3); their hosts are told the guest found another place (0603).
  update public.post_handoffs h
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded'
    from public.housing_booking_details d
   where d.handoff_id = h.handoff_id
     and h.recipient_id = v_h.recipient_id
     and h.world_slug = 'housing'
     and h.status = 'reserved'
     and h.handoff_id <> p_handoff_id
     and d.check_in_date < v_details.check_out_date and v_details.check_in_date < d.check_out_date;

  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.decide_housing_booking(uuid, boolean, text) from public, anon;
grant execute on function public.decide_housing_booking(uuid, boolean, text) to authenticated;

create or replace function public.cancel_housing_booking(p_handoff_id uuid, p_note text default null)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
  v_is_host boolean;
  v_late boolean;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'housing_note_too_long' using errcode = '23514';
  end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_uid not in (v_h.owner_id, v_h.recipient_id) then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_h.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  -- After check-in a stay is ended by completing it, not cancelled (FR-HOUSING-018 AC4).
  if now() >= v_h.slot_starts_at then
    raise exception 'housing_booking_started' using errcode = '23514';
  end if;
  v_is_host := v_uid = v_h.owner_id;
  if v_is_host and v_h.status = 'confirmed' and nullif(btrim(p_note), '') is null then
    raise exception 'housing_cancel_reason_required' using errcode = '23514';
  end if;
  v_late := v_h.status = 'confirmed' and now() > v_h.slot_starts_at
    - case when v_is_host then interval '48 hours' else interval '24 hours' end;

  update public.housing_booking_details
     set late_cancel = v_late, cancel_note = nullif(btrim(p_note), '')
   where handoff_id = p_handoff_id;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when v_is_host then 'host_cancelled' else 'guest_cancelled' end
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.cancel_housing_booking(uuid, text) from public, anon;
grant execute on function public.cancel_housing_booking(uuid, text) to authenticated;

create or replace function public.complete_housing_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
  v_details public.housing_booking_details;
  v_nights int;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_h.slot_starts_at or now() > v_h.slot_ends_at + interval '7 days' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  -- Nights stayed: the planned nights, or fewer when the guest left early (at least one).
  select * into v_details from public.housing_booking_details where handoff_id = p_handoff_id;
  v_nights := greatest(1, least(v_details.check_out_date - v_details.check_in_date,
                                public.housing_today() - v_details.check_in_date));

  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id;

  -- Hosting karma counts at most 7 nights per stay (spec 07 §7.6 cap).
  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, 'housing', p_handoff_id,
                                     least(v_nights, 7));
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.complete_housing_booking(uuid) from public, anon;
grant execute on function public.complete_housing_booking(uuid) to authenticated;

create or replace function public.mark_housing_no_show(p_handoff_id uuid)
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
   where handoff_id = p_handoff_id and world_slug = 'housing' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'confirmed' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if now() < v_h.slot_starts_at + interval '3 hours'
     or now() > v_h.slot_starts_at + interval '24 hours' then
    raise exception 'housing_not_in_window' using errcode = '23514';
  end if;

  update public.post_handoffs set status = 'no_show', no_show_at = now()
   where handoff_id = p_handoff_id;
  v_row := public.giving_handoff_row_of(p_handoff_id); -- 0622: built from the record
  return v_row;
end;
$$;

revoke all on function public.mark_housing_no_show(uuid) from public, anon;
grant execute on function public.mark_housing_no_show(uuid) to authenticated;

-- ── 6. delete_my_listing (0554) ─────────────────────────────────────────────────────────────────

create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  -- A handed-over handoff is the other side's record too (rating, karma), as for posts
  -- (FR-POST-010: a closed post with a recipient cannot be deleted).
  if exists (
    select 1 from public.post_handoffs h                        -- 0622: the record
     where h.post_id = public.post_id_of_listing(p_listing_id) -- 0622: the listing's post
       and h.world_slug <> 'time' -- 0622: event attendance never blocked the delete (0620)
       and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = p_listing_id;
  if v_row.origin = 'native' and v_row.legacy_post_id is not null then
    -- The post is the record; its listing goes with it (legacy_post_id cascades).
    delete from public.posts where post_id = v_row.legacy_post_id;
    return;
  end if;
  delete from public.listings where listing_id = p_listing_id;
end;
$$;

revoke all on function public.delete_my_listing(uuid) from public, anon;
grant execute on function public.delete_my_listing(uuid) to authenticated;

commit;
