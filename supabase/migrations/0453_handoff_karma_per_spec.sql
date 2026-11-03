-- 0453_handoff_karma_per_spec | D63 / G34 (D12, S20)
-- docs/spec/07_cross_cutting_systems.md §7.6: closing a gift earns the table
-- values — item giver 20 / receiver 15, food giver 20 / receiver 10, ride
-- driver 25 / passenger 10. Listing handoffs (0384, 0394, knowledge) awarded
-- 5 / 3 for every world. One config function now holds the values (the spec's
-- single KARMA_POINT_VALUES), and every handoff completion awards through it.
-- Worlds the table does not price yet keep 5 / 3. From now on only: past
-- awards are not recalculated (D63). The item "bonus up to 20" is not applied
-- to listing handoffs here.

begin;

create or replace function public.karma_handoff_points(p_world text, p_role text)
returns integer
language sql
immutable
as $$
  select case p_world
    when 'items' then case p_role when 'giver' then 20 else 15 end
    when 'food'  then case p_role when 'giver' then 20 else 10 end
    when 'rides' then case p_role when 'giver' then 25 else 10 end
    else case p_role when 'giver' then 5 else 3 end
  end;
$$;

create or replace function public.karma_award_handoff(
  p_giver uuid, p_receiver uuid, p_world text, p_handoff_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.karma_grant_once(p_giver, 'giving_handoff_giver', 'giving_handoff', p_handoff_id::text,
                                  public.karma_handoff_points(p_world, 'giver'));
  perform public.karma_grant_once(p_receiver, 'giving_handoff_receiver', 'giving_handoff', p_handoff_id::text,
                                  public.karma_handoff_points(p_world, 'receiver'));
end;
$$;
revoke execute on function public.karma_award_handoff(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Handoff completions: current definitions, only the award lines changed.
CREATE OR REPLACE FUNCTION public.mark_giving_handed_over(p_handoff_id uuid)
 RETURNS giving_handoffs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.giving_handoffs;
begin
  update public.giving_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_row;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  update public.listings
     set status = 'closed', availability_status = 'ongoing', updated_at = now()
   where listing_id = v_row.listing_id;

  perform public.karma_award_handoff(v_row.owner_id, v_row.recipient_id, v_row.world_slug, p_handoff_id);

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_ride_trip(p_handoff_id uuid)
 RETURNS giving_handoffs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform public.karma_award_handoff(v_row.owner_id, v_row.recipient_id, v_row.world_slug, p_handoff_id);

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_knowledge_session(p_handoff_id uuid)
 RETURNS giving_handoffs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform public.karma_award_handoff(v_row.owner_id, v_row.recipient_id, v_row.world_slug, p_handoff_id);

  return v_row;
end;
$function$;

commit;
