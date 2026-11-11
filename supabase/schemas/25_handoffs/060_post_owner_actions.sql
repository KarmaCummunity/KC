-- Handoffs · post management actions (publish, pause, resume, delete)
--
-- A device has no UPDATE privilege on posts.status: these are the named moves. Each one
-- asks kc_private.can_manage_post — today the owner; later also an admin of the post's
-- organization and the super admin — and then acts in the machine role `owner`.
-- Errors: SQLSTATE P0001 — post_not_found, listing_wrong_status, listing_has_active_handoff,
-- and whatever the post machine itself refuses (post_limit_exceeded, post_expired).

-- A delivered post may be deleted by its manager like any other (design §12.1); the
-- machine of the posts module only had this edge for the recipient un-mark (`system`).
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('post', 'closed_delivered', 'deleted_no_recipient', 'owner');

-- Publishes a draft.
create function public.publish_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
begin
  if v_post.status <> 'draft' then
    raise exception 'listing_wrong_status' using errcode = 'P0001';
  end if;
  -- An offer in items, food, housing or animals needs a photo (30_social/015, D132).
  perform kc_private.post_require_offer_photo(p_post_id);
  perform kc_private.post_move(p_post_id, 'open', 'owner');
end;
$$;
comment on function public.publish_post(uuid) is
  'Publishes a draft post (draft → open); an offer in a photo world needs a photo (offer_photo_required).';
grant execute on function public.publish_post(uuid) to authenticated;

-- Takes an open post off the air without closing it (D104). A reserved or confirmed
-- handoff refuses the pause; registrations of an event that has not started are cancelled
-- and each attendee is notified (D131).
create function public.pause_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
begin
  if v_post.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = 'P0001';
  end if;
  if kc_private.post_has_active_handoff(p_post_id) then
    raise exception 'listing_has_active_handoff' using errcode = 'P0001';
  end if;
  perform kc_private.post_move(p_post_id, 'paused', 'owner');
end;
$$;
comment on function public.pause_post(uuid) is
  'Pauses an open post; refused while a handoff is live, event registrations aside.';
grant execute on function public.pause_post(uuid) to authenticated;

-- Puts a paused post back on the air; refused after its expiry and beyond the open-post limit.
create function public.resume_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
begin
  if v_post.status <> 'paused' then
    raise exception 'listing_wrong_status' using errcode = 'P0001';
  end if;
  perform kc_private.post_move(p_post_id, 'open', 'owner');
end;
$$;
comment on function public.resume_post(uuid) is 'Resumes a paused post (paused → open).';
grant execute on function public.resume_post(uuid) to authenticated;

-- Deletes a published post in any status (design §12.1), also while members are
-- registered or a handoff is live: every live handoff is cancelled with the reason
-- `post_deleted` and its member is notified, then the post becomes `deleted_no_recipient`.
-- Nothing is destroyed yet: the purge job removes the post after seven days, and until
-- then public.reopen_post brings it back. A draft is deleted directly (it was never
-- published); a post removed by moderation is not the owner's to delete.
create function public.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
  v_handoff_id uuid;
begin
  if v_post.status = 'draft' then
    delete from public.posts p where p.id = p_post_id;
    return;
  end if;
  if v_post.status in ('removed_admin', 'deleted_no_recipient') then
    raise exception 'listing_wrong_status' using errcode = 'P0001';
  end if;

  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.post_id = p_post_id and h.status in ('waitlisted', 'reserved', 'confirmed')
  loop
    perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'owner', 'post_deleted');
  end loop;
  perform kc_private.post_move(p_post_id, 'deleted_no_recipient', 'owner');
end;
$$;
comment on function public.delete_post(uuid) is
  'Deletes a post in any status: cancels and notifies its live handoffs, then moves it to deleted_no_recipient until the purge.';
grant execute on function public.delete_post(uuid) to authenticated;
