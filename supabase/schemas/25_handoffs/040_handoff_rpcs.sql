-- Handoffs · the generic flow (items, food, animals; knowledge for confirm / hand over / cancel)
--
-- reserve → (owner confirms) → handed over, or cancelled by either side. Rides, stays and
-- events have their own RPCs, built on the same internals, in the module that owns their
-- detail tables. Errors: SQLSTATE P0001 with a stable snake_case message.

-- How a member takes an offer of this world, when one member takes the whole post:
--   'request'  the owner approves within 24 hours (items; animals for adoption or foster)
--   'claim'    confirmed at once, first come first served (food)
--   null       the world has its own flow, or several members take part
create function kc_private.handoff_flow_of(p_world_slug text, p_kind_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_world_slug = 'items' then 'request'
    when p_world_slug = 'food' then 'claim'
    when p_world_slug = 'animals' and exists (
           select 1 from public.post_kinds k
            where k.id = p_kind_id and k.slug in ('adoption_offer', 'foster_offer')) then 'request'
  end;
$$;
comment on function kc_private.handoff_flow_of(text, uuid) is
  'Generic single-taker flow of a world and post kind: request, claim, or null when the world has its own flow.';

-- Shared body of the two entry points below.
create function kc_private.handoff_take_offer(
  p_post_id uuid,
  p_flow text,
  p_pickup_mode text,
  p_pickup_window_start timestamptz,
  p_pickup_window_end timestamptz
)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_pickup_mode constant text := coalesce(nullif(btrim(p_pickup_mode), ''), 'pickup');
  v_post public.posts;
begin
  if v_pickup_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = 'P0001';
  end if;
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  if not found or v_post.direction <> 'offer'
     or kc_private.handoff_flow_of(v_post.world_slug, v_post.kind_id) is distinct from p_flow then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;

  return kc_private.handoff_open(
    p_post_id, v_user_id,
    case p_flow when 'claim' then 'confirmed' else 'reserved' end,
    1, 1,
    jsonb_strip_nulls(jsonb_build_object(
      'pickup_mode', v_pickup_mode,
      -- A claim is collected now unless the claimer names a time, and by the post's expiry.
      'pickup_window_start', coalesce(p_pickup_window_start, case p_flow when 'claim' then now() end),
      'pickup_window_end', coalesce(p_pickup_window_end,
        case p_flow when 'claim' then coalesce(v_post.expires_at, now() + interval '4 hours') end),
      'confirm_by', case p_flow when 'request' then now() + interval '24 hours' end)),
    case p_flow when 'claim' then 'listing_not_available' else 'item_already_reserved' end);
end;
$$;
comment on function kc_private.handoff_take_offer(uuid, text, text, timestamptz, timestamptz) is
  'Creates the caller''s handoff on a single-taker offer in the given flow.';

-- Asks for an item (or an animal offered for adoption or foster). The owner has 24 hours
-- to approve; meanwhile nobody else can ask.
create function public.reserve_item_giving(
  p_post_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.post_handoffs
language sql
security definer
set search_path = ''
as $$
  select kc_private.handoff_take_offer(
    p_post_id, 'request', p_pickup_mode, p_pickup_window_start, p_pickup_window_end);
$$;
comment on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) is
  'The caller asks for an item or animal offer; the owner approves within 24 hours.';
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

-- Claims a food offer: confirmed at once, first come first served.
create function public.claim_food_giving(
  p_post_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.post_handoffs
language sql
security definer
set search_path = ''
as $$
  select kc_private.handoff_take_offer(p_post_id, 'claim', 'pickup', p_pickup_window_start, p_pickup_window_end);
$$;
comment on function public.claim_food_giving(uuid, timestamptz, timestamptz) is
  'The caller claims a food offer; the claim is confirmed immediately.';
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated;

-- The owner approves a waiting request.
create function public.confirm_item_handoff(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_handoff.owner_id <> v_user_id or v_handoff.status <> 'reserved'
     or v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  return kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');
end;
$$;
comment on function public.confirm_item_handoff(uuid) is 'The post owner approves a waiting request.';
grant execute on function public.confirm_item_handoff(uuid) to authenticated;

-- Closes a post whose single taker has received it: the post becomes `closed_delivered`.
-- Only a post that is still open is closed; an expired, removed or under-review post keeps
-- its status and the handoff stands. Worlds where several members take part are closed by
-- their own module.
create function kc_private.post_close_after_handoff(p_handoff public.post_handoffs)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.posts p
              where p.id = p_handoff.post_id and p.status = 'open'
                and kc_private.handoff_flow_of(p.world_slug, p.kind_id) is not null) then
    perform kc_private.post_move(p_handoff.post_id, 'closed_delivered', 'system');
  end if;
end;
$$;
comment on function kc_private.post_close_after_handoff(public.post_handoffs) is
  'Moves an open single-taker post to closed_delivered once its handoff is handed over.';

-- Either member marks a confirmed handoff as handed over.
create function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_handoff public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_user_id not in (v_handoff.owner_id, v_handoff.recipient_id) then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  if v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_world_not_supported' using errcode = 'P0001';
  end if;
  if v_handoff.status <> 'confirmed' then
    raise exception 'handoff_not_confirmed' using errcode = 'P0001';
  end if;

  v_handoff := kc_private.handoff_move(
    p_handoff_id, 'handed_over', case v_user_id when v_handoff.owner_id then 'owner' else 'recipient' end);
  perform kc_private.post_close_after_handoff(v_handoff);
  return v_handoff;
end;
$$;
comment on function public.mark_giving_handed_over(uuid) is
  'Either member marks a confirmed handoff as handed over; a single-taker post closes as delivered.';
grant execute on function public.mark_giving_handed_over(uuid) to authenticated;

-- Either member cancels a waiting or confirmed handoff. The reason records who: the owner
-- declining a request, the owner withdrawing an approval, or the other member backing out.
-- The seat is free again at once.
create function public.cancel_giving_handoff(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
  v_by_owner constant boolean := v_user_id = v_handoff.owner_id;
begin
  if v_user_id not in (v_handoff.owner_id, v_handoff.recipient_id)
     or v_handoff.status not in ('reserved', 'confirmed') then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  -- Rides, stays and events cancel through their own RPCs (late-cancel rules, waiting list).
  if v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_world_not_supported' using errcode = 'P0001';
  end if;

  return kc_private.handoff_move(
    p_handoff_id, 'cancelled',
    case when v_by_owner then 'owner' else 'recipient' end,
    case when not v_by_owner then 'recipient_cancelled'
         when v_handoff.status = 'reserved' then 'declined'
         else 'owner_cancelled' end);
end;
$$;
comment on function public.cancel_giving_handoff(uuid) is
  'Either member cancels their waiting or confirmed handoff.';
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;
