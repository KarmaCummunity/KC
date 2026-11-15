-- 0702_fsm_comments_knowledge_topics | Wave 4b of the FSM kernel program (#1989, G61)
--
-- 1. `post_comments.status` (machine `post_comment`): active → deleted, final (FR-POST-014..018,
--    0250 / 0251). A before-update trigger guards every writer. Comments are written only through
--    their RPCs: `rpc_update_post_comment` and `rpc_delete_post_comment` run as definer with the
--    same author / active-row checks, and the client's direct UPDATE on the table is revoked (the
--    app never wrote the table directly).
-- 2. `knowledge_topics.status` (machine `knowledge_topic`): proposed → active | merged,
--    active → merged; merged is final (FR-KNOW-001, 0570). Rejecting a proposal deletes the row,
--    so it is not a state. A before-update trigger guards every writer, and approving an active
--    topic is a no-op instead of re-stamping `approved_by` with the current operator.

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('post_comment', 'active'),
  ('post_comment', 'deleted');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('post_comment', 'active', 'deleted', '');

insert into public.fsm_state (machine_id, status) values
  ('knowledge_topic', 'proposed'),
  ('knowledge_topic', 'active'),
  ('knowledge_topic', 'merged');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('knowledge_topic', 'proposed', 'active', ''),
  ('knowledge_topic', 'proposed', 'merged', ''),
  ('knowledge_topic', 'active', 'merged', '');

-- ── 2. Status triggers ─────────────────────────────────────────────────────────
create or replace function kc_private.post_comments_enforce_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same status: not a transition (a body edit, for one).
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('post_comment', old.status, new.status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'post_comment_transition_invalid'
          using errcode = '23514',
                detail = format('invalid comment transition from %s to %s', old.status, new.status);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.post_comments_enforce_fsm() is
  'FSM wave 4b (0702): post_comments.status moves follow machine `post_comment`; raises post_comment_transition_invalid (23514) otherwise.';

revoke all on function kc_private.post_comments_enforce_fsm() from public, anon, authenticated;

drop trigger if exists post_comments_status_fsm on public.post_comments;
create trigger post_comments_status_fsm
  before update of status on public.post_comments
  for each row execute function kc_private.post_comments_enforce_fsm();

create or replace function kc_private.knowledge_topics_enforce_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same status: not a transition (a rename or a re-parent, for one).
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('knowledge_topic', old.status, new.status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'knowledge_topic_transition_invalid'
          using errcode = '23514',
                detail = format('invalid knowledge topic transition from %s to %s', old.status, new.status);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.knowledge_topics_enforce_fsm() is
  'FSM wave 4b (0702): knowledge_topics.status moves follow machine `knowledge_topic`; raises knowledge_topic_transition_invalid (23514) otherwise.';

revoke all on function kc_private.knowledge_topics_enforce_fsm() from public, anon, authenticated;

drop trigger if exists knowledge_topics_status_fsm on public.knowledge_topics;
create trigger knowledge_topics_status_fsm
  before update of status on public.knowledge_topics
  for each row execute function kc_private.knowledge_topics_enforce_fsm();

-- ── 3. Comment writes go through their RPCs ────────────────────────────────────
-- Same bodies as 0251, now SECURITY DEFINER: the author / active-row filter in each WHERE is the
-- check the RLS update policy made, so the client no longer needs a table UPDATE grant.
create or replace function public.rpc_update_post_comment(
  p_comment_id uuid,
  p_body text
)
returns public.post_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_comments;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 then
    raise exception 'comment_body_required' using errcode = '22023';
  end if;

  update public.post_comments
     set body = trim(p_body),
         mention_user_ids = public.resolve_comment_mentions(trim(p_body)),
         edited_at = now()
   where comment_id = p_comment_id
     and author_id = (select auth.uid())
     and status = 'active'
  returning * into v_row;

  if v_row.comment_id is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

create or replace function public.rpc_delete_post_comment(p_comment_id uuid)
returns public.post_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_comments;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  update public.post_comments
     set status = 'deleted'
   where comment_id = p_comment_id
     and author_id = (select auth.uid())
     and status = 'active'
  returning * into v_row;

  if v_row.comment_id is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.rpc_update_post_comment(uuid, text) from public, anon;
grant execute on function public.rpc_update_post_comment(uuid, text) to authenticated;
revoke all on function public.rpc_delete_post_comment(uuid) from public, anon;
grant execute on function public.rpc_delete_post_comment(uuid) to authenticated;

revoke update on public.post_comments from authenticated;

-- ── 4. review_knowledge_topic (0570): approve moves only a proposal ────────────
create or replace function public.review_knowledge_topic(
  p_topic_id uuid,
  p_action text,
  p_merge_into_id uuid default null,
  p_label_he text default null,
  p_label_en text default null
)
returns public.knowledge_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.knowledge_topics;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not is_listing_operator(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_row from knowledge_topics where topic_id = p_topic_id for update;
  if not found then
    raise exception 'knowledge_topic_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'merged' then
    raise exception 'knowledge_topic_already_merged' using errcode = '23514';
  end if;

  if p_action = 'approve' then
    -- 0702: approving an active topic is a no-op; it no longer overwrites approved_by.
    if v_row.status = 'proposed' then
      update knowledge_topics set status = 'active', approved_by = v_uid
       where topic_id = p_topic_id returning * into v_row;
    end if;
  elsif p_action = 'reject' then
    if v_row.status <> 'proposed' then
      raise exception 'knowledge_topic_not_proposed' using errcode = '23514';
    end if;
    if exists (select 1 from knowledge_topics where parent_id = p_topic_id) then
      raise exception 'knowledge_topic_has_children' using errcode = '23514';
    end if;
    delete from knowledge_topics where topic_id = p_topic_id;
  elsif p_action = 'rename' then
    update knowledge_topics
       set label_he = coalesce(nullif(btrim(p_label_he), ''), label_he),
           label_en = coalesce(nullif(btrim(p_label_en), ''), label_en)
     where topic_id = p_topic_id returning * into v_row;
  elsif p_action = 'merge' then
    if p_merge_into_id is null or p_merge_into_id = p_topic_id then
      raise exception 'knowledge_topic_merge_target_invalid' using errcode = '22023';
    end if;
    if not exists (select 1 from knowledge_topics where topic_id = p_merge_into_id and status = 'active') then
      raise exception 'knowledge_topic_merge_target_invalid' using errcode = '22023';
    end if;
    perform knowledge_topic_merge(p_topic_id, p_merge_into_id);
    select * into v_row from knowledge_topics where topic_id = p_topic_id;
  else
    raise exception 'knowledge_topic_action_invalid' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

