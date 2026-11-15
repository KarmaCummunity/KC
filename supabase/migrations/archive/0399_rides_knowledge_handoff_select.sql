-- 0399: revoke direct DML; cancel restores availability only for single-seat worlds;
-- get_listing_handoff returns the caller's active handoff, else their latest
-- handed_over handoff they haven't rated yet (so the rating step shows in every world).

begin;

drop policy if exists giving_handoffs_insert_none on public.giving_handoffs;
revoke insert on public.giving_handoffs from authenticated;
revoke update on public.giving_handoffs from authenticated;

-- Multi-seat / multi-slot worlds keep listing open until capacity exhausted elsewhere.
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

  if v_row.world_slug in ('items', 'food') then
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = v_row.listing_id and status = 'open';
  end if;
end;
$$;

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
    from public.giving_handoffs h
   where h.listing_id = p_listing_id
     and (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     and (
       h.status in ('reserved', 'confirmed')
       or (
         h.status = 'handed_over'
         and not exists (
           select 1 from public.giving_handoff_ratings r
            where r.handoff_id = h.handoff_id and r.rater_id = auth.uid())
       )
     )
   order by (h.status in ('reserved', 'confirmed')) desc, h.reserved_at desc
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
    'confirmed_at', v_h.confirmed_at,
    'seats', v_h.seats,
    'slot_starts_at', v_h.slot_starts_at,
    'slot_ends_at', v_h.slot_ends_at
  );
end;
$$;

commit;
