-- Handoffs · closing and reopening a post (FR-CLOSURE-*)
--
-- "Mark as delivered" ends in one of two ways: with a named member (`closed_delivered`) or
-- without one (`deleted_no_recipient`, purged after seven days). Both can be reopened by
-- the owner; a named member can remove their own mark. Counters, karma events, chat and
-- push events follow from the status changes (030, 050); nothing is repeated here.
-- Errors: SQLSTATE P0001 — post_not_found, closure_wrong_status,
-- closure_recipient_not_in_chat, world_not_assignable, listing_has_active_handoff,
-- reopen_window_expired, not_recipient_or_wrong_status.

-- Closes an open post naming the member who received it (or, on a request, who gave):
-- FR-CLOSURE-003 AC5, FR-CLOSURE-011. A handoff that member already holds is completed;
-- otherwise one is created already handed over. Anyone else waiting is cancelled as
-- superseded. For worlds where one member takes the whole post; a ride or a stay assigns
-- its seats through its own module.
create function public.close_post_with_recipient(p_post_id uuid, p_recipient_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
  v_handoff public.post_handoffs;
begin
  if v_post.status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if kc_private.handoff_flow_of(v_post.world_slug, v_post.kind_id) is null then
    raise exception 'world_not_assignable' using errcode = 'P0001';
  end if;
  -- The member must be someone who could have taken the post: not the owner, active, inside
  -- the post's audience, and not blocked in either direction.
  if p_recipient_id is null or p_recipient_id = v_post.owner_id
     or not kc_private.post_open_to_member(v_post, p_recipient_id) then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  select h.* into v_handoff from public.post_handoffs h
   where h.post_id = p_post_id and h.recipient_id = p_recipient_id
     and h.status in ('reserved', 'confirmed')
     for update;
  if found then
    v_handoff := kc_private.handoff_move(v_handoff.id, 'handed_over', 'owner');
  else
    insert into public.post_handoffs (post_id, recipient_id, status)
    values (p_post_id, p_recipient_id, 'handed_over')
    returning * into v_handoff;
  end if;

  -- Closing cancels every other live handoff of the post (050).
  perform kc_private.post_move(p_post_id, 'closed_delivered', 'owner');
  return v_handoff;
end;
$$;
comment on function public.close_post_with_recipient(uuid, uuid) is
  'Closes an open post as delivered to the named member and returns their handoff.';
grant execute on function public.close_post_with_recipient(uuid, uuid) to authenticated;

-- Closes an open post as delivered without naming anyone (FR-CLOSURE-003 AC6): it counts
-- as given, becomes `deleted_no_recipient` and is purged after seven days unless reopened.
-- Refused while a handoff is live (D104) — the owner settles it first, or names its member.
create function public.close_post_without_recipient(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
begin
  if v_post.status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if kc_private.post_has_active_handoff(p_post_id) then
    raise exception 'listing_has_active_handoff' using errcode = 'P0001';
  end if;

  -- Recorded before the move, which reads it to decide the owner's counter.
  insert into public.post_closures (post_id, delivered) values (p_post_id, true)
  on conflict (post_id) do update set delivered = true;
  perform kc_private.post_move(p_post_id, 'deleted_no_recipient', 'owner');
end;
$$;
comment on function public.close_post_without_recipient(uuid) is
  'Closes an open post as delivered to nobody in particular; purged after seven days unless reopened.';
grant execute on function public.close_post_without_recipient(uuid) to authenticated;

-- Reopens a closed or deleted post (FR-CLOSURE-005); also the undo of public.delete_post.
--   closed_delivered      the recipient mark of a single-taker post is withdrawn (the
--                         handoff is cancelled as `reopened`; nobody is notified, D-6)
--   deleted_no_recipient  only inside the seven-day grace period
-- The open-post limit applies as for any post becoming open (FR-POST-011).
create function public.reopen_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_lock_managed(p_post_id);
  v_handoff_id uuid;
begin
  if v_post.status not in ('closed_delivered', 'deleted_no_recipient') then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_post.status = 'deleted_no_recipient' and exists (
       select 1 from public.post_closures c where c.post_id = p_post_id and c.purge_after <= now()) then
    raise exception 'reopen_window_expired' using errcode = 'P0001';
  end if;

  if kc_private.handoff_flow_of(v_post.world_slug, v_post.kind_id) is not null then
    for v_handoff_id in
      select h.id from public.post_handoffs h where h.post_id = p_post_id and h.status = 'handed_over'
    loop
      perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'owner', 'reopened');
    end loop;
  end if;
  perform kc_private.post_move(p_post_id, 'open', 'owner');
end;
$$;
comment on function public.reopen_post(uuid) is
  'Returns a closed_delivered post, or a deleted_no_recipient post inside its grace period, to open.';
grant execute on function public.reopen_post(uuid) to authenticated;

-- The member named as recipient removes their own mark (FR-CLOSURE-007). The post stays a
-- delivery in the owner's counter but has no recipient any more, so it moves to
-- `deleted_no_recipient`: the owner may reopen it, name someone else, or let it be purged.
-- The owner is notified (FR-NOTIF-010) and the removal is recorded for the audit trail.
create function public.recipient_unmark_self(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_handoff_id uuid;
begin
  -- Post first, then the handoff: the same lock order as a concurrent reopen by the owner.
  perform 1 from public.posts p where p.id = p_post_id for update;
  select h.id into v_handoff_id
    from public.post_handoffs h
    join public.posts p on p.id = h.post_id
   where h.post_id = p_post_id and h.recipient_id = v_user_id and h.status = 'handed_over'
     and h.machine_id = 'giving_handoff' and p.status = 'closed_delivered'
     for update of h;
  if not found then
    raise exception 'not_recipient_or_wrong_status' using errcode = 'P0001';
  end if;

  perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'recipient', 'unmarked');
  perform kc_private.post_move(p_post_id, 'deleted_no_recipient', 'system');
  perform kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', 'recipient_unmarked', 'actor_id', v_user_id,
    'entity', jsonb_build_object('type', 'post', 'id', p_post_id),
    'data', jsonb_build_object('handoff_id', v_handoff_id)));
end;
$$;
comment on function public.recipient_unmark_self(uuid) is
  'The caller removes their recipient mark from a delivered post; the post moves to deleted_no_recipient.';
grant execute on function public.recipient_unmark_self(uuid) to authenticated;
