-- Moderation · staff actions on content (FR-ADMIN-002, FR-ADMIN-005, FR-ADMIN-009, D129)
--
-- Removing a post is a status move to `removed_admin`; the post machine remembers the status
-- it left and a restore returns exactly there (a post hidden for review returns to open).
-- Nothing is destroyed. Moderators and above may act. Errors: forbidden (42501); P0001 —
-- target_not_found, invalid_target_state.

-- Removes a post in the name of a staff member. Returns false when it was already removed
-- (idempotent, no second audit row: FR-ADMIN-009 AC5). A draft was never published and
-- cannot be removed.
create function kc_private.moderation_remove_post(p_post_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if v_post.status = 'removed_admin' then
    return false;
  end if;
  if v_post.status = 'draft' then
    raise exception 'invalid_target_state' using errcode = 'P0001';
  end if;

  perform kc_private.post_move(p_post_id, 'removed_admin', 'admin');
  perform kc_private.moderation_queue_close('post', p_post_id, p_actor);
  perform kc_private.audit_record(
    'manual_remove_target', 'post', p_post_id, jsonb_build_object('from', v_post.status), p_actor);
  perform kc_private.notify_moderation_outcome('post_removed', v_post.owner_id, p_post_id);
  return true;
end;
$$;

-- Restores a removed post to the status it was removed from, or a post hidden for review
-- to open. Returns false for a post in any other status (idempotent).
create function kc_private.moderation_restore_post(p_post_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
  v_to text;
begin
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  v_to := case v_post.status
            when 'removed_admin' then v_post.status_before_removal
            when 'hidden_pending_review' then 'open'
          end;
  if v_to is null then
    return false;
  end if;

  perform kc_private.post_move(p_post_id, v_to, 'admin');
  perform kc_private.moderation_queue_close('post', p_post_id, p_actor);
  perform kc_private.audit_record(
    'restore_target', 'post', p_post_id, jsonb_build_object('from', v_post.status, 'to', v_to), p_actor);
  perform kc_private.notify_moderation_outcome('post_restored', v_post.owner_id, p_post_id);
  return true;
end;
$$;

create function public.admin_remove_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.moderation_remove_post(p_post_id, kc_private.require_admin_role('moderator'));
end;
$$;
comment on function public.admin_remove_post(uuid) is
  'Staff: removes a published post in any status (→ removed_admin); the owner is notified.';
grant execute on function public.admin_remove_post(uuid) to authenticated;

create function public.admin_restore_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.moderation_restore_post(p_post_id, kc_private.require_admin_role('moderator'));
end;
$$;
comment on function public.admin_restore_post(uuid) is
  'Staff: returns a removed post to its previous status, or a post hidden for review to open (D129).';
grant execute on function public.admin_restore_post(uuid) to authenticated;

-- Staff delete a comment (machine role `admin`), with the replies under it, as the author's
-- own delete does. The rows stay, readable to staff only. Idempotent on a deleted comment.
create function public.admin_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_comment public.post_comments;
begin
  select c.* into v_comment from public.post_comments c where c.id = p_comment_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if v_comment.status = 'deleted' then
    return;
  end if;

  perform set_config('kc.fsm_role', 'admin', true);
  update public.post_comments c
     set status = 'deleted'
   where (c.id = p_comment_id or c.parent_comment_id = p_comment_id) and c.status = 'active';
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.audit_record(
    'manual_remove_target', 'comment', p_comment_id, jsonb_build_object('post_id', v_comment.post_id), v_actor);
end;
$$;
comment on function public.admin_delete_comment(uuid) is 'Staff: deletes a comment and its replies; audited.';
grant execute on function public.admin_delete_comment(uuid) to authenticated;

-- Hook for the messaging module's admin delete of a chat message (FR-ADMIN-005 AC2). That
-- module owns the tables, so it owns the delete; it calls this first, in the same
-- transaction: the caller must be a moderator, and the deletion is audited with ids only.
-- Returns the acting staff member.
create function kc_private.moderation_authorize_message_delete(p_message_id uuid, p_chat_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
begin
  perform kc_private.audit_record(
    'delete_message', 'chat', p_chat_id, jsonb_build_object('message_id', p_message_id), v_actor);
  return v_actor;
end;
$$;
comment on function kc_private.moderation_authorize_message_delete(uuid, uuid) is
  'Messaging hook: checks the moderator role and audits the deletion of a chat message.';
