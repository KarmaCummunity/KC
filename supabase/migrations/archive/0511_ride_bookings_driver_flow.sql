-- 0511_ride_bookings_driver_flow | Driver manages every booking; both sides hear every change
-- (docs/spec/05_giving_worlds.md §5.3, D73; approved fills S44 + S45; gap G47).
--
--   1. giving_handoffs.cancel_reason records why a booking ended (declined, expired, …).
--      A BEFORE trigger fills it from the caller when a path does not set it, so every
--      existing cancel path (generic cancel_giving_handoff, cancel_ride_booking) is covered.
--   2. book_ride_seat: a booking must be approved within 12 hours or before departure,
--      whichever is earlier (S45) — confirm_by = least(now() + 12h, departs_at).
--   3. decline_ride_booking: the driver declines a waiting booking (frees the seat).
--   4. list_ride_bookings: the driver sees every booking on their ride, with the passenger
--      and whether the driver already rated that passenger.
--   5. ride_bookings_expire_sweep (every 10 min): waiting bookings past confirm_by expire.
--   6. One notification per booking change to the other side. All are `critical`, so
--      they bypass quiet hours (S44) and land on the ride's listing screen.
--   7. The rides world is switched on (active world, D60) for the tester builds.

begin;

-- ── 1. Why a booking ended ────────────────────────────────────────────────────
alter table public.giving_handoffs
  add column if not exists cancel_reason text
    check (cancel_reason in ('declined', 'expired', 'passenger_cancelled', 'driver_cancelled', 'system'));

comment on column public.giving_handoffs.cancel_reason is
  'Why a cancelled handoff ended. Filled by trigger from the caller when a path does not set it (0511).';

-- The caller decides the reason unless the path already set one (decline / expiry).
create or replace function public.giving_handoffs_set_cancel_reason()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.cancel_reason is null then
    new.cancel_reason := case auth.uid()
      when new.recipient_id then 'passenger_cancelled'
      when new.owner_id then 'driver_cancelled'
      else 'system'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists giving_handoffs_set_cancel_reason on public.giving_handoffs;
create trigger giving_handoffs_set_cancel_reason
  before update of status on public.giving_handoffs
  for each row execute function public.giving_handoffs_set_cancel_reason();

-- ── 2. Booking: approval deadline = 12 h or departure, whichever is earlier ──
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
  v_l public.listings;
  v_cap int;
  v_taken int;
  v_departs timestamptz;
  v_seats int := greatest(1, least(coalesce(p_seats, 1), 8));
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  -- Lock the listing row so concurrent bookings can't oversell seats.
  select * into v_l from public.listings
   where listing_id = p_listing_id and world_slug = 'rides' and status = 'open'
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
     where listing_id = p_listing_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;

  v_cap := coalesce((v_l.details->>'seats_available')::int, 1);
  select coalesce(sum(seats), 0)::int into v_taken
    from public.giving_handoffs
   where listing_id = p_listing_id
     and world_slug = 'rides'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken + v_seats > v_cap then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;

  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status, seats, confirm_by
  ) values (
    p_listing_id, v_l.owner_id, v_uid, 'rides', 'reserved', v_seats,
    least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── 3. Driver declines a waiting booking ─────────────────────────────────────
create or replace function public.decline_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;

  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'declined'
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ── 4. Every booking on a ride, for its driver ───────────────────────────────
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
begin
  if auth.uid() is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.listings l
     where l.listing_id = p_listing_id and l.world_slug = 'rides' and l.owner_id = auth.uid()
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  return query
    select h.handoff_id, h.recipient_id, u.display_name, u.avatar_url, h.seats, h.status,
           h.reserved_at, h.confirm_by,
           -- The driver rates each passenger once after the trip (spec 07 §7.7).
           exists (select 1 from public.giving_handoff_ratings r
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
      from public.giving_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.listing_id = p_listing_id
       and h.status in ('reserved', 'confirmed', 'handed_over')
     order by (h.status = 'reserved') desc, h.reserved_at;
end;
$$;

-- ── 5. Waiting bookings expire at their deadline ─────────────────────────────
create or replace function public.ride_bookings_expire_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'expired'
   where world_slug = 'rides'
     and status = 'reserved'
     and confirm_by < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.ride_bookings_expire_sweep() is
  'Every 10 min: ride bookings the driver did not approve by confirm_by expire and free their seats (S45).';

-- ── 6. Notify the other side of every booking change ─────────────────────────
-- The counterpart's display name and the ride title go into the push text; the tap opens
-- the ride (marketplace listing). Dedupe per (booking, change) keeps retries idempotent.
create or replace function public.ride_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_kind text;
  v_to uuid;
  v_actor uuid;
begin
  if tg_op = 'INSERT' and new.status = 'reserved' then
    v_kind := 'ride_booking_requested'; v_to := new.owner_id; v_actor := new.recipient_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'confirmed' then
      v_kind := 'ride_booking_confirmed'; v_to := new.recipient_id; v_actor := new.owner_id;
    elsif new.status = 'cancelled' then
      case new.cancel_reason
        when 'declined' then v_kind := 'ride_booking_declined'; v_to := new.recipient_id; v_actor := new.owner_id;
        when 'expired' then v_kind := 'ride_booking_expired'; v_to := new.recipient_id; v_actor := new.owner_id;
        when 'passenger_cancelled' then v_kind := 'ride_booking_cancelled'; v_to := new.owner_id; v_actor := new.recipient_id;
        else v_kind := 'ride_booking_cancelled'; v_to := new.recipient_id; v_actor := new.owner_id;
      end case;
    end if;
  end if;
  if v_kind is null then return new; end if;

  select title into v_title from public.listings where listing_id = new.listing_id;
  perform public.enqueue_notification(
    v_to, 'critical', v_kind,
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Title',
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Body',
    jsonb_build_object(
      'name', coalesce((select display_name from public.users where user_id = v_actor), ''),
      'rideTitle', coalesce(v_title, ''),
      'seats', new.seats),
    jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                       'params', jsonb_build_object('listingId', new.listing_id::text)),
    v_kind || ':' || new.handoff_id::text,
    false
  );
  return new;
end;
$$;

-- `ride_booking_requested` → `rideBookingRequested` (copy keys are camelCase).
create or replace function public.ride_booking_copy_key(p_kind text)
returns text
language sql
immutable
as $$
  select 'rideBooking' || initcap(split_part(p_kind, '_', 3));
$$;

drop trigger if exists giving_handoffs_ride_notify on public.giving_handoffs;
create trigger giving_handoffs_ride_notify
  after insert or update of status on public.giving_handoffs
  for each row when (new.world_slug = 'rides')
  execute function public.ride_booking_notify();

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function public.decline_ride_booking(uuid) from public;
revoke all on function public.list_ride_bookings(uuid) from public;
revoke all on function public.ride_bookings_expire_sweep() from public, anon, authenticated;
revoke all on function public.ride_booking_notify() from public, anon, authenticated;
grant execute on function public.decline_ride_booking(uuid) to authenticated;
grant execute on function public.list_ride_bookings(uuid) to authenticated;
grant execute on function public.ride_bookings_expire_sweep() to service_role;

comment on function public.decline_ride_booking is 'Driver declines a waiting ride booking (D73).';
comment on function public.list_ride_bookings is 'Every booking on a ride, for its driver only (D73).';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ride_bookings_expire_sweep') then
      perform cron.unschedule('ride_bookings_expire_sweep');
    end if;
    perform cron.schedule(
      'ride_bookings_expire_sweep',
      '*/10 * * * *',
      $sql$ select public.ride_bookings_expire_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — ride_bookings_expire_sweep not scheduled.';
  end if;
end $$;

-- ── 7. Rides is an active world (D60) ────────────────────────────────────────
update public.app_flags set enabled = true where key = 'world_rides_enabled';

commit;
