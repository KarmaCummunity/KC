-- 0396: book / complete knowledge lessons via giving_handoffs.
-- Ratings reuse rate_giving_handoff (0384), which works for any handed_over handoff.
-- Karma reuses karma_grant_once (giving_handoff_giver/receiver, idempotent per handoff).

begin;

create or replace function public.book_knowledge_slot(p_listing_id uuid)
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
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  -- Lock the listing row so concurrent bookings can't oversell slots.
  select * into v_l from public.listings
   where listing_id = p_listing_id and world_slug = 'knowledge' and status = 'open'
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
     where listing_id = p_listing_id and recipient_id = v_uid
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;

  v_cap := coalesce((v_l.details->>'slots_available')::int, 1);
  select count(*)::int into v_taken
    from public.giving_handoffs
   where listing_id = p_listing_id and world_slug = 'knowledge'
     and status in ('reserved', 'confirmed', 'handed_over');
  if v_taken >= v_cap then raise exception 'slots_exhausted' using errcode = 'P0001'; end if;

  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status,
    seats, slot_starts_at, slot_ends_at, confirm_by
  ) values (
    p_listing_id, v_l.owner_id, v_uid, 'knowledge', 'reserved',
    1, v_start, v_end, now() + interval '24 hours'
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- A session can be completed from 15 minutes before its start.
create or replace function public.complete_knowledge_session(p_handoff_id uuid)
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
   where handoff_id = p_handoff_id and world_slug = 'knowledge' for update;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  if v_row.owner_id <> v_uid and v_row.recipient_id <> v_uid then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_row.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  if v_row.slot_starts_at is not null and v_row.slot_starts_at > now() + interval '15 minutes' then
    raise exception 'session_not_started' using errcode = '23514';
  end if;

  update public.giving_handoffs
     set status = 'handed_over', handed_over_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id
  returning * into v_row;

  perform public.karma_grant_once(v_row.owner_id, 'giving_handoff_giver', 'giving_handoff', p_handoff_id::text, 5);
  perform public.karma_grant_once(v_row.recipient_id, 'giving_handoff_receiver', 'giving_handoff', p_handoff_id::text, 3);

  return v_row;
end;
$$;

revoke all on function public.book_knowledge_slot(uuid) from public;
revoke all on function public.complete_knowledge_session(uuid) from public;
grant execute on function public.book_knowledge_slot(uuid) to authenticated;
grant execute on function public.complete_knowledge_session(uuid) to authenticated;

commit;
