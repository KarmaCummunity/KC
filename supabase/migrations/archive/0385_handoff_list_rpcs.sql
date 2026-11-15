-- 0385_handoff_list_rpcs | Active handoff lookup + my handoffs list.

begin;

create or replace function public.get_listing_handoff(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_h public.giving_handoffs%rowtype;
begin
  select * into v_h
    from public.giving_handoffs
   where listing_id = p_listing_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
   order by reserved_at desc
   limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'handoff_id', v_h.handoff_id,
    'listing_id', v_h.listing_id,
    'owner_id', v_h.owner_id,
    'recipient_id', v_h.recipient_id,
    'world_slug', v_h.world_slug,
    'status', v_h.status,
    'pickup_mode', v_h.pickup_mode,
    'pickup_window_start', v_h.pickup_window_start,
    'pickup_window_end', v_h.pickup_window_end,
    'confirm_by', v_h.confirm_by,
    'reserved_at', v_h.reserved_at,
    'confirmed_at', v_h.confirmed_at
  );
end;
$$;

create or replace function public.list_my_giving_handoffs(p_limit int default 50)
returns table (
  handoff_id uuid,
  listing_id uuid,
  title text,
  world_slug text,
  status text,
  role text,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  reserved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.handoff_id,
    h.listing_id,
    l.title,
    h.world_slug,
    h.status,
    case when h.owner_id = auth.uid() then 'owner' else 'recipient' end as role,
    h.pickup_window_start,
    h.pickup_window_end,
    h.reserved_at
  from public.giving_handoffs h
  join public.listings l on l.listing_id = h.listing_id
  where (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
    and h.status <> 'cancelled'
  order by h.reserved_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.get_listing_handoff(uuid) from public;
grant execute on function public.get_listing_handoff(uuid) to authenticated;
revoke all on function public.list_my_giving_handoffs(int) from public;
grant execute on function public.list_my_giving_handoffs(int) to authenticated;

commit;
