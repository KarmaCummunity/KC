-- 0394: complete a ride trip → handed_over + karma (reuses the 0384 handoff pattern:
-- karma_grant_once with giving_handoff_giver/receiver, idempotent per handoff).
-- A trip can be completed from 1 hour before departure. The listing closes once
-- every booked seat is handed over and capacity is reached.

begin;

create or replace function public.complete_ride_trip(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.giving_handoffs;
  v_l public.listings;
  v_departs timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.giving_handoffs
   where handoff_id = p_handoff_id and world_slug = 'rides' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid and v_row.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_row.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;

  select * into v_l from public.listings where listing_id = v_row.listing_id for update;
  v_departs := nullif(v_l.details->>'departs_at', '')::timestamptz;
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;

  update public.giving_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id
  returning * into v_row;

  if v_l.status = 'open'
     and not exists (
       select 1 from public.giving_handoffs h
        where h.listing_id = v_l.listing_id and h.status in ('reserved', 'confirmed'))
     and (
       select coalesce(sum(h.seats), 0) from public.giving_handoffs h
        where h.listing_id = v_l.listing_id and h.status = 'handed_over'
     ) >= coalesce((v_l.details->>'seats_available')::int, 1)
  then
    update public.listings set status = 'closed', updated_at = now()
     where listing_id = v_l.listing_id;
  end if;

  perform public.karma_grant_once(v_row.owner_id, 'giving_handoff_giver', 'giving_handoff', p_handoff_id::text, 5);
  perform public.karma_grant_once(v_row.recipient_id, 'giving_handoff_receiver', 'giving_handoff', p_handoff_id::text, 3);

  return v_row;
end;
$$;

revoke all on function public.complete_ride_trip(uuid) from public;
grant execute on function public.complete_ride_trip(uuid) to authenticated;

commit;
