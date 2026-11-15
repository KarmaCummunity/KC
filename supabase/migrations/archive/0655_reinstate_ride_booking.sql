-- 0655_reinstate_ride_booking | Driver can put back a passenger they declined or cancelled
-- by mistake (D73). Lists recent cancelled rows; reinstate restores reserved or confirmed.
begin;

create or replace function public.reinstate_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h public.post_handoffs;
  v_ride public.ride_post_details;
  v_cap int;
  v_departs timestamptz;
  v_row public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  perform 1 from public.posts
   where post_id = v_h.post_id and world_slug = 'rides' and status = 'open'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_h from public.post_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_h.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_h.status <> 'cancelled' then raise exception 'invalid_status' using errcode = '23514'; end if;
  if v_h.cancel_reason not in ('declined', 'driver_cancelled') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.post_handoffs h2
     where h2.post_id = v_h.post_id
       and h2.recipient_id = v_h.recipient_id
       and h2.handoff_id <> v_h.handoff_id
       and h2.status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;

  select * into v_ride from public.ride_post_details where post_id = v_h.post_id;
  v_departs := v_ride.departs_at;
  if v_departs <= now() then
    raise exception 'ride_departed' using errcode = '23514';
  end if;

  v_cap := coalesce(v_ride.seats_available, 1);
  if public.post_handoff_seats_taken(v_h.post_id, p_handoff_id) + v_h.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;

  if v_h.cancel_reason = 'declined' then
    update public.post_handoffs
       set status = 'reserved',
           cancelled_at = null,
           cancel_reason = null,
           confirm_by = least(now() + interval '12 hours', coalesce(v_departs, now() + interval '12 hours'))
     where handoff_id = p_handoff_id;
  else
    update public.post_handoffs
       set status = 'confirmed',
           cancelled_at = null,
           cancel_reason = null,
           confirmed_at = coalesce(v_h.confirmed_at, now())
     where handoff_id = p_handoff_id;
  end if;

  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

comment on function public.reinstate_ride_booking(uuid) is
  'Ride owner restores a booking they declined or cancelled; seat cap re-checked (D73).';

revoke all on function public.reinstate_ride_booking(uuid) from public, anon;
grant execute on function public.reinstate_ride_booking(uuid) to authenticated;

drop function if exists public.list_ride_bookings(uuid);
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
  rated_by_me    boolean,
  requested_stop_label text,
  cancel_reason  text
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
                    where r.handoff_id = h.handoff_id and r.rater_id = auth.uid()),
           left(h.requested_meeting_point ->> 'label', 120),
           h.cancel_reason
      from public.post_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id
       and (
         h.status in ('reserved', 'confirmed', 'handed_over')
         or (
           h.status = 'cancelled'
           and h.cancel_reason in ('declined', 'driver_cancelled')
           and h.cancelled_at > now() - interval '30 days'
           and not exists (
             select 1 from public.post_handoffs h2
              where h2.post_id = v_post_id
                and h2.recipient_id = h.recipient_id
                and h2.status in ('reserved', 'confirmed')
           )
         )
       )
     order by (h.status = 'reserved') desc, (h.status = 'cancelled') asc, h.reserved_at;
end;
$$;

revoke all on function public.list_ride_bookings(uuid) from public, anon;
grant execute on function public.list_ride_bookings(uuid) to authenticated;

commit;
