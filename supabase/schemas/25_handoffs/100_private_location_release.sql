-- Handoffs · release of a post's exact address (design §3.9)
--
-- The exact address is readable from the table by the post owner only. The other member
-- of a handoff receives it through this RPC, and only once the handoff is confirmed —
-- a request that is still waiting, was cancelled or ended as a no-show releases nothing,
-- and a booking with a time slot stops releasing it 24 hours after the slot ends.

-- Returns the exact location of a post to a caller who manages it, or who holds a
-- confirmed or completed handoff on it; null when the post has no exact address. A release
-- to the other member is recorded as an `audit` event with ids only, never the address.
--   post_not_found  the caller is neither (also when the post does not exist)
create function public.get_post_private_location(p_post_id uuid)
returns public.post_private_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_handoff_id uuid;
  v_location public.post_private_locations;
begin
  if not kc_private.can_manage_post(p_post_id) then
    select h.id into v_handoff_id
      from public.post_handoffs h
     where h.post_id = p_post_id and h.recipient_id = v_user_id
       and h.status in ('confirmed', 'handed_over')
       -- A booked time ends the release 24 hours after it (stays and events, spec 5.6 S53).
       and (h.slot_ends_at is null or h.slot_ends_at + interval '24 hours' > now())
     order by h.created_at desc
     limit 1;
    if not found then
      raise exception 'post_not_found' using errcode = 'P0001';
    end if;
    perform kc_private.outbox_enqueue('audit', jsonb_build_object(
      'action', 'post_private_location_released', 'actor_id', v_user_id,
      'entity', jsonb_build_object('type', 'post', 'id', p_post_id),
      'data', jsonb_build_object('handoff_id', v_handoff_id)));
  end if;

  select l.* into v_location from public.post_private_locations l where l.post_id = p_post_id;
  return v_location;
end;
$$;
comment on function public.get_post_private_location(uuid) is
  'Exact address of a post, for its owner and for the member of a confirmed handoff; each release to that member is audited.';
grant execute on function public.get_post_private_location(uuid) to authenticated;
