-- Worlds · ride bookings (machine `ride_booking` on post_handoffs, D70, D73, D96)
--
-- A passenger books seats on a ride offer; the driver approves or declines each booking;
-- either side cancels; the driver may bring back a booking they declined or cancelled;
-- the trip is completed per booking or for the whole ride. Seats held by reserved,
-- confirmed and completed bookings never exceed the seats of the ride: every writer holds
-- the post row lock. Pushes, counters and karma events follow from the status change
-- (25_handoffs/030). Errors: SQLSTATE P0001 — listing_not_available, own_listing,
-- item_already_reserved, not_ride_offer, ride_departed, ride_not_started, seats_exhausted,
-- ride_seats_exhausted, ride_place_invalid, handoff_not_found, invalid_status.

-- Books seats on a ride offer. The booking waits for the driver and lapses 12 hours after
-- it was made or at departure, whichever is earlier (D96). The passenger may ask for one
-- of the ride's places as their meeting point (FR-RIDE-030).
create function public.book_ride_seat(
  p_post_id uuid, p_seats integer default 1, p_requested_meeting_point jsonb default null)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
  v_ride public.post_ride_details;
begin
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  select r.* into v_ride from public.post_ride_details r where r.post_id = p_post_id;
  if not found or not kc_private.post_bookable_by(v_post, v_user_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  if v_post.direction <> 'offer' then
    raise exception 'not_ride_offer' using errcode = 'P0001';
  end if;
  if v_ride.departs_at <= now() then
    raise exception 'ride_departed' using errcode = 'P0001';
  end if;
  if p_seats is null or p_seats not between 1 and 8 then
    raise exception 'seats_exhausted' using errcode = 'P0001';
  end if;
  if p_requested_meeting_point is not null
     and not coalesce(p_requested_meeting_point ?& array['kind', 'id', 'label'], false) then
    raise exception 'ride_place_invalid' using errcode = 'P0001';
  end if;

  return kc_private.handoff_open(
    p_post_id, v_user_id, 'reserved', v_ride.seats, p_seats,
    jsonb_strip_nulls(jsonb_build_object(
      'confirm_by', least(now() + interval '12 hours', v_ride.departs_at),
      'requested_meeting_point', p_requested_meeting_point)));
end;
$$;
comment on function public.book_ride_seat(uuid, integer, jsonb) is
  'The caller books seats on a ride offer; the driver approves within 12 hours or by departure.';
grant execute on function public.book_ride_seat(uuid, integer, jsonb) to authenticated;

-- The driver approves a waiting booking. Its seats were held when it was made, so an
-- approval can never overbook the ride.
create function public.confirm_ride_booking(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff constant public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'ride_booking', true);
begin
  if v_handoff.status <> 'reserved' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if (select r.departs_at from public.post_ride_details r where r.post_id = v_handoff.post_id) <= now() then
    raise exception 'ride_departed' using errcode = 'P0001';
  end if;
  return kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');
end;
$$;
comment on function public.confirm_ride_booking(uuid) is 'The driver approves a waiting ride booking.';
grant execute on function public.confirm_ride_booking(uuid) to authenticated;

-- Either side cancels a waiting or approved booking; its seats are free at once. The
-- reason records who and when: the driver declining a request (`declined`), the driver
-- withdrawing an approval (`driver_cancelled`), or the passenger (`passenger_cancelled`).
create function public.cancel_ride_booking(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff constant public.post_handoffs :=
    kc_private.world_handoff_lock(p_handoff_id, 'ride_booking', false, false);
  v_by_owner constant boolean := v_handoff.owner_id = (select auth.uid());
begin
  if v_handoff.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  return kc_private.handoff_move(
    p_handoff_id, 'cancelled',
    case when v_by_owner then 'owner' else 'recipient' end,
    case when not v_by_owner then 'passenger_cancelled'
         when v_handoff.status = 'reserved' then 'declined'
         else 'driver_cancelled' end);
end;
$$;
comment on function public.cancel_ride_booking(uuid) is
  'Either side cancels a ride booking; a driver cancelling a waiting booking declines it.';
grant execute on function public.cancel_ride_booking(uuid) to authenticated;

-- The driver brings back a booking they declined (it waits again, with a fresh deadline)
-- or cancelled after approving it (it is approved again). Refused once the ride departed,
-- when the passenger can no longer take the ride or holds another booking on it, and when
-- the seats were given away meanwhile.
create function public.reinstate_ride_booking(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'ride_booking', true);
  v_post public.posts;
  v_ride public.post_ride_details;
begin
  if v_handoff.status <> 'cancelled' or v_handoff.cancel_reason not in ('declined', 'driver_cancelled') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  select p.* into v_post from public.posts p where p.id = v_handoff.post_id;
  select r.* into v_ride from public.post_ride_details r where r.post_id = v_handoff.post_id;
  if not kc_private.post_open_to_member(v_post, v_handoff.recipient_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  if v_ride.departs_at <= now() then
    raise exception 'ride_departed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.post_handoffs h
              where h.post_id = v_handoff.post_id and h.recipient_id = v_handoff.recipient_id
                and h.status in ('reserved', 'confirmed')) then
    raise exception 'item_already_reserved' using errcode = 'P0001';
  end if;
  if kc_private.handoff_seats_taken(v_handoff.post_id) + v_handoff.seats > v_ride.seats then
    raise exception 'ride_seats_exhausted' using errcode = 'P0001';
  end if;

  if v_handoff.cancel_reason = 'driver_cancelled' then
    return kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');
  end if;
  perform kc_private.handoff_move(p_handoff_id, 'reserved', 'owner');
  update public.post_handoffs h
     set confirm_by = least(now() + interval '12 hours', v_ride.departs_at)
   where h.id = p_handoff_id
  returning h.* into v_handoff;
  return v_handoff;
end;
$$;
comment on function public.reinstate_ride_booking(uuid) is
  'The driver reinstates a ride booking they declined or cancelled, if the ride still has room.';
grant execute on function public.reinstate_ride_booking(uuid) to authenticated;

-- Marks one booking as travelled, from one hour before departure: the passenger for an
-- approved booking, the driver also for one still waiting. The ride closes as delivered
-- once no booking is live and every seat was used.
create function public.complete_ride_trip(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs := kc_private.world_handoff_lock(p_handoff_id, 'ride_booking');
  v_by_owner constant boolean := v_handoff.owner_id = (select auth.uid());
  v_ride public.post_ride_details;
begin
  if v_handoff.status <> 'confirmed' and not (v_by_owner and v_handoff.status = 'reserved') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  select r.* into v_ride from public.post_ride_details r where r.post_id = v_handoff.post_id;
  if v_ride.departs_at > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = 'P0001';
  end if;

  v_handoff := kc_private.handoff_move(
    p_handoff_id, 'handed_over', case when v_by_owner then 'owner' else 'recipient' end);
  if exists (select 1 from public.posts p where p.id = v_handoff.post_id and p.status = 'open')
     and not exists (select 1 from public.post_handoffs h
                      where h.post_id = v_handoff.post_id and h.status in ('reserved', 'confirmed'))
     and kc_private.handoff_seats_taken(v_handoff.post_id) >= v_ride.seats then
    perform kc_private.post_move(v_handoff.post_id, 'closed_delivered', 'system');
  end if;
  return v_handoff;
end;
$$;
comment on function public.complete_ride_trip(uuid) is
  'Marks one ride booking as travelled; a full ride with nothing left open closes as delivered.';
grant execute on function public.complete_ride_trip(uuid) to authenticated;

-- "Ride completed" (spec 5.3 step 7): the driver finishes the whole ride once, from one
-- hour before departure. Approved bookings complete together, the offer closes as
-- delivered and bookings still waiting end with it (cancelled as superseded by the
-- closure, 25_handoffs/050). Returns the number of bookings completed.
create function public.complete_ride(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
  v_handoff_id uuid;
  v_completed integer := 0;
begin
  if v_post.post_type <> 'ride' or v_post.direction <> 'offer' then
    raise exception 'not_ride_offer' using errcode = 'P0001';
  end if;
  if v_post.status <> 'open' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if (select r.departs_at from public.post_ride_details r where r.post_id = p_post_id)
     > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = 'P0001';
  end if;

  for v_handoff_id in
    select h.id from public.post_handoffs h where h.post_id = p_post_id and h.status = 'confirmed'
  loop
    perform kc_private.handoff_move(v_handoff_id, 'handed_over', 'owner');
    v_completed := v_completed + 1;
  end loop;
  perform kc_private.post_move(p_post_id, 'closed_delivered', 'owner');
  return v_completed;
end;
$$;
comment on function public.complete_ride(uuid) is
  'The driver completes a ride: approved bookings are marked travelled and the offer closes as delivered.';
grant execute on function public.complete_ride(uuid) to authenticated;
