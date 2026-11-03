-- G47 follow-up: approving a ride booking must preserve the listing's seat cap.
-- Serialize approval with booking creation by locking the listing before counting seats.

begin;

create or replace function public.confirm_ride_booking(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
  v_listing public.listings;
  v_cap int;
  v_occupied int;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  -- Read the immutable listing id first so locks follow listing → booking order,
  -- matching complete_ride_listing and avoiding a cycle with ride completion.
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  -- Take the same per-listing lock as book_ride_seat before reading occupied seats.
  select * into v_listing from public.listings
   where listing_id = v_row.listing_id and world_slug = 'rides'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;

  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_status' using errcode = '23514'; end if;

  v_cap := coalesce((v_listing.details->>'seats_available')::int, 1);
  select coalesce(sum(seats), 0)::int into v_occupied
    from public.giving_handoffs
   where listing_id = v_row.listing_id
     and world_slug = 'rides'
     and status in ('reserved', 'confirmed', 'handed_over')
     and handoff_id <> p_handoff_id;

  if v_occupied + v_row.seats > v_cap then
    raise exception 'ride_seats_exhausted' using errcode = '23514';
  end if;

  update public.giving_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.confirm_ride_booking(uuid) from public;
grant execute on function public.confirm_ride_booking(uuid) to authenticated;

commit;
