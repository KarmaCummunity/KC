-- 0382_items_handoff_rpcs | Items: reserve -> confirm -> handed over / cancel.

begin;

create or replace function public._giving_handoff_from_listing(p_listing_id uuid)
returns table (
  listing_id uuid,
  owner_id uuid,
  world_slug text,
  status text,
  details jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id, l.owner_id, l.world_slug, l.status, l.details
    from public.listings l
   where l.listing_id = p_listing_id
     and l.world_slug = 'items'
     and l.direction = 'give'
     and l.status = 'open'
     and public.is_listing_visible_to(l, auth.uid());
$$;

create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_l record;
  v_row public.giving_handoffs;
  v_mode text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public._giving_handoff_from_listing(p_listing_id);
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  v_mode := coalesce(nullif(trim(p_pickup_mode), ''), 'pickup');
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = '23514';
  end if;

  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status,
    pickup_mode, pickup_window_start, pickup_window_end, confirm_by
  ) values (
    p_listing_id, v_l.owner_id, v_uid, 'items', 'reserved',
    v_mode,
    coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz),
    coalesce(p_pickup_window_end, (v_l.details->>'pickup_window_end')::timestamptz),
    now() + interval '24 hours'
  )
  returning * into v_row;

  update public.listings
     set availability_status = 'scheduled', updated_at = now()
   where listing_id = p_listing_id;

  return v_row;
end;
$$;

create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.giving_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
     and owner_id = auth.uid()
     and status = 'reserved'
     and world_slug = 'items'
  returning * into v_row;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.giving_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_row;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  update public.listings
     set availability_status = 'immediate', updated_at = now()
   where listing_id = v_row.listing_id and status = 'open';
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;
revoke all on function public.confirm_item_handoff(uuid) from public;
grant execute on function public.confirm_item_handoff(uuid) to authenticated;
revoke all on function public.cancel_giving_handoff(uuid) from public;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;

commit;
