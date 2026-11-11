-- 0735_event_close_no_owner_karma | An organizer's close of an event earns no "fulfilled" karma
-- (D124; G18 end-to-end review, #2084 / #2078)
--
-- `fulfill_my_listing` (0686) closes an owner's open offer as `closed_delivered` and grants the
-- owner 4 karma for a fulfilled listing, in every world. For an organization's event that is
-- wrong: an event's karma is earned only for the attendance its organizer marks (10 points per
-- attendee, D124), so closing an event repeatedly would be a karma source of its own. The close
-- itself is unchanged: before the start it cancels the open registrations and notifies each
-- attendee (D131, 0686); after the start they stay for attendance marking.

-- Same body as 0686, except that an event post (`post_type = 'event'`) grants no karma.
-- Errors unchanged: listing_wrong_status, listing_has_active_handoff (23514).
create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_status text;
  v_lid uuid;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'open' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug <> 'time'  -- 0686: event registrations are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'closed_delivered');
    -- 0735: an event's karma is its marked attendance (D124), never the organizer's close.
    if v_post.post_type is distinct from 'event' then
      v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id);
      perform public.karma_grant_once(v_post.owner_id, 'listing_fulfilled', 'listing', v_lid::text, 4);
    end if;
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings set status = 'closed', updated_at = now() where listing_id = p_listing_id;
  perform public.karma_grant_once(auth.uid(), 'listing_fulfilled', 'listing', p_listing_id::text, 4);
end;
$$;

comment on function public.fulfill_my_listing(uuid) is
  'Owner closes an open offer as delivered (0686); 4 karma once, except for an event, whose karma is its marked attendance (0735, D124).';
