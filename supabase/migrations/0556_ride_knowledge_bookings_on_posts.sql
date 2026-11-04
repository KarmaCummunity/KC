-- 0556_ride_knowledge_bookings_on_posts.sql | G1 step 3b (ADR-006, D19, D-217): the ride and
-- knowledge booking RPCs and the handoff readers accept a post id.
--
-- Step 3a (0555) made `post_handoffs` the record of the items and food handoffs: every item is a
-- post and every food offer created through the app is post-sourced, so the record always has a
-- post to hang on. Rides and knowledge are not there yet: a recurring ride's later occurrences
-- have no post until the earlier one departs (0531 keeps the feed to the soonest occurrence), and
-- a knowledge listing gets its post only when its owner shares it to the feed (`worlds.feed_mirror`
-- is off for knowledge). Those listings are open and bookable today, so their bookings must keep
-- `giving_handoffs` as the record until every listing of a handoff world has a post (sub-step
-- 3b-pre, BACKLOG `G1-S3`); the 0553 sync copies them to `post_handoffs` as soon as a post exists.
--
-- What this step does move is the id contract, which the one detail screen (step 4) needs:
-- `book_ride_seat`, `complete_ride_listing`, `list_ride_bookings`, `book_knowledge_slot` and
-- `get_listing_handoff` accept a post id or a listing id in `p_listing_id`. Their bodies are the
-- latest definitions (0511, 0530, 0396, 0399) with the id resolved first; signatures, returned
-- rows and error codes are unchanged. Additive and idempotent.

begin;

-- ── Id resolution ─────────────────────────────────────────────────────────────────────────────

-- A booking or reader argument is a listing id (the marketplace screens) or a post id (the one
-- detail screen): either resolves to the listing the booking rules still live on.
create or replace function public.handoff_target_listing_id(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.listing_id from public.listings l where l.listing_id = p_id),
    public.listing_id_of_post(p_id));
$$;

comment on function public.handoff_target_listing_id(uuid) is
  'G1: resolves a listing id or a post id to the listing a booking acts on; null when neither exists.';

revoke all on function public.handoff_target_listing_id(uuid) from public, anon, authenticated;
grant execute on function public.handoff_target_listing_id(uuid) to service_role;

-- ── Rides (0511, 0530) ────────────────────────────────────────────────────────────────────────

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
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_l public.listings;
  v_cap int;
  v_taken int;
  v_departs timestamptz;
  v_seats int := greatest(1, least(coalesce(p_seats, 1), 8));
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = v_listing_id and world_slug = 'rides' and status = 'open'
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
    select 1 from public.giving_handoffs
     where listing_id = v_listing_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce((v_l.details->>'seats_available')::int, 1);
  select coalesce(sum(seats), 0)::int into v_taken
    from public.giving_handoffs
   where listing_id = v_listing_id
     and world_slug = 'rides'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken + v_seats > v_cap then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;
  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status, seats, confirm_by
  ) values (
    v_listing_id, v_l.owner_id, v_uid, 'rides', 'reserved', v_seats,
    least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.book_ride_seat(uuid, int) from public, anon;
grant execute on function public.book_ride_seat(uuid, int) to authenticated;

create or replace function public.complete_ride_listing(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_listing public.listings;
  v_departs timestamptz;
  v_completed integer := 0;
  v_h public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_listing from public.listings
   where listing_id = v_listing_id and world_slug = 'rides' and direction = 'give'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_listing.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_listing.status <> 'open' then raise exception 'invalid_status' using errcode = '23514'; end if;
  v_departs := nullif(v_listing.details->>'departs_at', '')::timestamptz;
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;
  for v_h in
    update public.giving_handoffs
       set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
     where listing_id = v_listing_id and world_slug = 'rides' and status = 'confirmed'
     returning *
  loop
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, v_h.handoff_id);
    v_completed := v_completed + 1;
  end loop;
  update public.giving_handoffs
     set status = 'cancelled', cancel_reason = 'system'
   where listing_id = v_listing_id and world_slug = 'rides' and status = 'reserved';
  update public.listings set status = 'closed', updated_at = now()
   where listing_id = v_listing_id;
  return v_completed;
end;
$$;

revoke all on function public.complete_ride_listing(uuid) from public, anon, authenticated;
grant execute on function public.complete_ride_listing(uuid) to authenticated;

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
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.listings l
     where l.listing_id = v_listing_id and l.world_slug = 'rides' and l.owner_id = auth.uid()
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
           h.reserved_at, h.confirm_by,
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.giving_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.listing_id = v_listing_id
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, h.reserved_at;
end;
$$;

revoke all on function public.list_ride_bookings(uuid) from public, anon;
grant execute on function public.list_ride_bookings(uuid) to authenticated;

-- ── Knowledge (0396) ──────────────────────────────────────────────────────────────────────────

create or replace function public.book_knowledge_slot(p_listing_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_l public.listings;
  v_cap int;
  v_taken int;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = v_listing_id and world_slug = 'knowledge' and status = 'open'
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
    select 1 from public.giving_handoffs
     where listing_id = v_listing_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  v_cap := coalesce((v_l.details->>'slots_available')::int, 1);
  select count(*)::int into v_taken
    from public.giving_handoffs
   where listing_id = v_listing_id and world_slug = 'knowledge'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken >= v_cap then raise exception 'slots_exhausted' using errcode = 'P0001'; end if;
  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status,
    seats, slot_starts_at, slot_ends_at, confirm_by
  ) values (
    v_listing_id, v_l.owner_id, v_uid, 'knowledge', 'reserved',
    1, v_start, v_end, now() + interval '24 hours'
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.book_knowledge_slot(uuid) from public, anon;
grant execute on function public.book_knowledge_slot(uuid) to authenticated;

-- ── The caller's handoff on a listing or post (0399) ──────────────────────────────────────────

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
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_h public.giving_handoffs%rowtype;
begin
  select * into v_h
    from public.giving_handoffs h
   where h.listing_id = v_listing_id
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
    'listing_id', v_h.listing_id,
    'post_id', public.post_id_of_listing(v_h.listing_id),
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

commit;
