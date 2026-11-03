-- 0532: Serialize item reservations and return a stable domain error when claimed.

begin;

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
  v_l public.listings%rowtype;
  v_row public.giving_handoffs;
  v_mode text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  -- Serialize attempts on this listing before checking for a live handoff.
  select l.* into v_l
    from public.listings l
   where l.listing_id = p_listing_id
     and l.world_slug = 'items'
     and l.direction = 'give'
     and l.status = 'open'
     and public.is_listing_visible_to(l, v_uid)
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if exists (
    select 1 from public.giving_handoffs h
     where h.listing_id = p_listing_id
       and h.status in ('reserved', 'confirmed')
       and h.world_slug in ('items', 'food')
  ) then
    raise exception 'item_already_reserved' using errcode = '23514';
  end if;

  v_mode := coalesce(nullif(trim(p_pickup_mode), ''), 'pickup');
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = '23514';
  end if;

  begin
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
  exception when unique_violation then
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.listings
     set availability_status = 'scheduled', updated_at = now()
   where listing_id = p_listing_id;

  return v_row;
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

commit;
