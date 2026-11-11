-- 0734_rides_expiry_settles_bookings | A ride that expires without leaving settles its bookings
-- (FR-RIDE, docs/spec/requirements/15_rides.md: "when the cron expires a ride, approved riders'
-- seats transition to a terminal cancelled row with system attribution").
--
-- `rides_expired_listings_sweep` (0624) expired an open ride post hours after its departure but
-- left its bookings live, so a passenger's seat stayed "confirmed" on a trip that never left and
-- an unanswered request stayed pending. A ride that departed is `in_transit` or later, never
-- swept, so an open ride at expiry is a trip that did not run in the app.
--
-- 1. The sweep now cancels each live booking with it: an unanswered request as `expired` (its
--    existing push, `ride_booking_expired`), a confirmed seat as `system`.
-- 2. `ride_booking_notify` (0621) tells a passenger whose confirmed seat went with an expired ride
--    that the ride did not run (`ride_booking_lapsed`), instead of naming the driver as the one
--    who cancelled. Every other move pushes as before.

-- ── 1. The sweep settles the bookings ──────────────────────────────────────────
create or replace function public.rides_expired_listings_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_post  public.posts;
begin
  for v_post in
    select p.* from public.posts p
     where p.world_slug = 'rides'
       and p.direction = 'offer'
       and p.status = 'open'
       and p.expires_at is not null
       and p.expires_at <= now()
       for update
  loop
    perform public.ride_post_set_status(v_post, 'expired');

    -- 0734: the trip did not run, so no booking stays live on it.
    update public.post_handoffs
       set status = 'cancelled',
           cancelled_at = now(),
           cancel_reason = case status when 'reserved' then 'expired' else 'system' end
     where post_id = v_post.post_id
       and world_slug = 'rides'
       and status in ('reserved', 'confirmed');

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.rides_expired_listings_sweep() is
  'FR-RIDE (0624, 0734): expires open ride offers past their expiry and cancels their live bookings (a request as expired, a confirmed seat as system).';

-- ── 2. The passenger hears that the ride did not run ───────────────────────────
-- Same body as 0621, plus the `system` cancel of a seat on an expired ride.
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
        else
          -- 0734: a seat cancelled by the system on an expired ride: the ride did not run.
          if new.cancel_reason = 'system'
             and exists (select 1 from public.posts p where p.post_id = new.post_id and p.status = 'expired') then
            v_kind := 'ride_booking_lapsed';
          else
            v_kind := 'ride_booking_cancelled';
          end if;
          v_to := new.recipient_id; v_actor := new.owner_id;
      end case;
    end if;
  end if;
  if v_kind is null then return new; end if;

  select title into v_title from public.posts where post_id = new.post_id;
  perform public.enqueue_notification(
    v_to, 'critical', v_kind,
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Title',
    'notifications.' || public.ride_booking_copy_key(v_kind) || 'Body',
    jsonb_build_object(
      'name', coalesce((select display_name from public.users where user_id = v_actor), ''),
      'rideTitle', coalesce(v_title, ''),
      'seats', new.seats),
    jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                       'params', jsonb_build_object(
                         'listingId', public.listing_id_of_post(new.post_id)::text)),
    v_kind || ':' || new.handoff_id::text,
    false
  );
  return new;
end;
$$;
