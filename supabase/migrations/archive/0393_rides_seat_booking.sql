-- 0393: book / confirm / cancel ride seats via giving_handoffs (row-locked capacity).

begin;

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
  if nullif(v_l.details->>'departs_at', '')::timestamptz <= now() then
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
    now() + interval '12 hours'
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.cancel_ride_booking(p_handoff_id uuid)
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
  if v_row.recipient_id <> v_uid and v_row.owner_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_row.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.confirm_ride_booking(p_handoff_id uuid)
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
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;
  update public.giving_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.book_ride_seat(uuid, int) from public;
revoke all on function public.cancel_ride_booking(uuid) from public;
revoke all on function public.confirm_ride_booking(uuid) from public;
grant execute on function public.book_ride_seat(uuid, int) to authenticated;
grant execute on function public.cancel_ride_booking(uuid) to authenticated;
grant execute on function public.confirm_ride_booking(uuid) to authenticated;

commit;
