-- 0733_animals_handoff_push_and_cancel | Animals take the item handoff flow end to end
--
-- An adoption or foster request runs the item flow since 0658 (reserve, confirm, hand over, the
-- 24-hour expiry of 0716), but two writers still listed only items and food:
--
-- 1. `post_handoffs_giving_notify` (0621) fired for items and food only, so an animal request,
--    its approval, decline, cancel and hand-over pushed no one. It now fires for animals too;
--    the copy is world-neutral (FR-NOTIF-018).
-- 2. `cancel_giving_handoff` (0666) returned an item or food post to `immediate` when its live
--    handoff was cancelled or declined, but left an animal post `scheduled`, so it looked taken.
--    One live handoff per animal post holds since 0658, so the post is free once it is cancelled.
-- 3. `cancel_giving_handoff` also cancelled event registrations, skipping the waitlist promotion
--    of `cancel_event_registration` (0564), so a freed place stayed empty. Like housing (0603), an
--    event registration now names its own cancel (`event_use_registration_cancel`); the app
--    already calls it. Ride bookings keep this path: their notify trigger and seat count follow
--    the handoff rows either way.

-- ── 1. Pushes for animal handoffs ──────────────────────────────────────────────
drop trigger if exists post_handoffs_giving_notify on public.post_handoffs;
create trigger post_handoffs_giving_notify
  after insert or update of status on public.post_handoffs
  for each row when (new.world_slug in ('items', 'food', 'animals'))
  execute function public.giving_handoff_notify();

-- ── 2. Cancelling frees an animal post too ─────────────────────────────────────
-- Same body as 0666 except the world lists. Errors: housing_use_booking_cancel,
-- event_use_registration_cancel (23514), handoff_not_found (P0002).
create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_lid uuid;
begin
  -- Housing stays and event registrations cancel through their own RPC.
  select * into v_h from public.post_handoffs where handoff_id = p_handoff_id;
  if v_h.world_slug = 'housing' then
    raise exception 'housing_use_booking_cancel' using errcode = '23514';
  elsif v_h.world_slug = 'time' then
    raise exception 'event_use_registration_cancel' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  -- The single-recipient worlds (one live handoff per post) are available again.
  if v_h.world_slug in ('items', 'food', 'animals') then
    update public.posts
       set availability_status = 'immediate', updated_at = now()
     where post_id = v_h.post_id and status = 'open';
    v_lid := public.listing_id_of_post(v_h.post_id);
    if v_lid is not null then
      update public.listings
         set availability_status = 'immediate', updated_at = now()
       where listing_id = v_lid and status = 'open';
    end if;
  end if;
end;
$$;

comment on function public.cancel_giving_handoff(uuid) is
  'FR-CLOSURE / 0733: either side cancels a live item, food, animal or knowledge handoff (the giver''s cancel of a request is a decline); item, food and animal posts are available again. Housing stays and event registrations cancel through their own RPCs.';

revoke all on function public.cancel_giving_handoff(uuid) from public, anon;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;
