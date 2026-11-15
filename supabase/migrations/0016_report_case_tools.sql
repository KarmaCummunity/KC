-- Moderation · the report case tools of the admin portal (FR-ADMIN-002, FR-ADMIN-007,
-- FR-ADMIN-012, FR-ADMIN-013, FR-MOD-010)
--
-- 1. Staff read the row of a reported chat (ids and times only, never its messages), so a
--    chat case shows whether it is hidden for review.
-- 2. A direct restore closes the case: the target's open reports are stamped
--    dismissed_no_violation and count against their reporters (FR-ADMIN-002 AC4, FR-MOD-010).
-- 3. A moderator restores a reported chat (FR-ADMIN-002 AC2, FR-ADMIN-013 AC2).
-- 4. A moderator restores a comment staff removed (FR-ADMIN-013 AC2), with the replies the
--    same removal took; the author's own deletions stay final.
-- 5. The reports inbox is grouped and paged on the server, with no cap on open reports, and
--    can be searched by target id or reporter name (FR-ADMIN-012 AC1–AC4).
-- 6. A report case shows its whole history to every staff member who may read the case,
--    whoever acted (FR-ADMIN-013 AC1; the role-scoped audit search hid other staff's steps).
-- 7. The super admin's member audit lookup returns what the member did and what was done to
--    them (FR-ADMIN-007).

-- ── 1. Reported chats are readable to staff (row only) ────────────────────────────────────
create policy chats_select_staff_reported on public.chats
  for select to authenticated
  using ((select kc_access.is_admin())
         and exists (select 1 from public.reports r where r.target_type = 'chat' and r.target_id = chats.id));

-- ── 2. A restore closes the case ──────────────────────────────────────────────────────────

-- Dismisses every open report on a target in the name of a staff member: each is stamped
-- and audited, and counts against its reporter (FR-MOD-010). Returns the number dismissed.
create function kc_private.report_dismiss_open(p_target_type text, p_target_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_reporter uuid;
  v_done integer := 0;
begin
  for v_report_id in
    select r.id from public.reports r
     where r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open'
     order by r.created_at
  loop
    v_reporter := (kc_private.report_resolve(v_report_id, 'dismissed_no_violation', p_actor)).reporter_id;
    perform kc_private.apply_false_report_sanction(v_reporter);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;
comment on function kc_private.report_dismiss_open(text, uuid, uuid) is
  'Dismisses the open reports of a restored target; they count against their reporters.';

create or replace function public.admin_restore_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
begin
  if kc_private.moderation_restore_post(p_post_id, v_actor) then
    perform kc_private.report_dismiss_open('post', p_post_id, v_actor);
  end if;
end;
$$;
comment on function public.admin_restore_post(uuid) is
  'Staff: returns a removed post to its previous status, or a post hidden for review to open (D129); the open reports are dismissed.';

create or replace function public.admin_restore_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_status text;
begin
  select a.status into v_status from public.user_account a where a.user_id = p_user_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if v_status = 'active' then
    return;
  end if;
  if v_status not in ('suspended_admin', 'suspended_for_false_reports', 'banned') then
    raise exception 'invalid_restore_state' using errcode = 'P0001';
  end if;
  if v_status = 'banned' then
    perform kc_private.require_admin_role('super_admin');
  end if;
  perform kc_private.account_restore(p_user_id, v_actor, 'admin_restore');
  perform kc_private.moderation_queue_close('user', p_user_id, v_actor);
  perform kc_private.report_dismiss_open('user', p_user_id, v_actor);
end;
$$;
comment on function public.admin_restore_user(uuid) is
  'Staff: lifts a suspension (only the super admin lifts a ban); the open reports are dismissed.';

-- ── 3. Restore a chat ─────────────────────────────────────────────────────────────────────

-- Unhides a chat hidden for review, for both members, at once. A `restore` event follows any
-- `hide` event still queued for the chat, so a late hide cannot undo it. Idempotent on a chat
-- that is neither hidden nor waiting to be (no second audit row). Errors: forbidden (42501); P0001 —
-- target_not_found.
create function public.admin_restore_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_hidden_at timestamptz;
begin
  select c.moderation_hidden_at into v_hidden_at from public.chats c where c.id = p_chat_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  -- Nothing to restore unless the chat is hidden or a hide is still on its way (the case's
  -- review entry is open while the queued hide waits for the chat_moderation job).
  if v_hidden_at is null and not exists (
       select 1 from public.moderation_queue q
        where q.target_type = 'chat' and q.target_id = p_chat_id and q.status = 'open') then
    return;
  end if;
  update public.chats c set moderation_hidden_at = null where c.id = p_chat_id;
  perform kc_private.outbox_enqueue('moderation_target', jsonb_build_object(
    'kind', 'restore', 'target_type', 'chat', 'target_id', p_chat_id));
  perform kc_private.moderation_queue_close('chat', p_chat_id, v_actor);
  perform kc_private.audit_record('restore_target', 'chat', p_chat_id,
                                  jsonb_build_object('hidden_at', v_hidden_at), v_actor);
  perform kc_private.report_dismiss_open('chat', p_chat_id, v_actor);
end;
$$;
comment on function public.admin_restore_chat(uuid) is
  'Staff: unhides a chat hidden for review; the open reports are dismissed. Idempotent.';
grant execute on function public.admin_restore_chat(uuid) to authenticated;

-- ── 4. Restore a comment ──────────────────────────────────────────────────────────────────

-- Set when staff removed the comment, the same instant on the replies that removal took;
-- null for a live comment and for one its author or the post owner deleted.
alter table public.post_comments add column moderation_removed_at timestamptz;
comment on column public.post_comments.moderation_removed_at is
  'When staff removed the comment (and the replies removed with it); null otherwise.';

insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('post_comment', 'deleted', 'active', 'admin');

-- A comment that comes back counts again in post_stats.comments_count.
create or replace function kc_private.post_comments_sync_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform kc_private.post_stats_add(
      'comments', 1, array(select c.post_id from changed c where c.status = 'active'));
  elsif tg_op = 'DELETE' then
    perform kc_private.post_stats_add(
      'comments', -1, array(select c.post_id from changed c where c.status = 'active'));
  else
    perform kc_private.post_stats_add(
      'comments', -1,
      array(select o.post_id from changed o join changed_new n on n.id = o.id
             where o.status = 'active' and n.status <> 'active'));
    perform kc_private.post_stats_add(
      'comments', 1,
      array(select o.post_id from changed o join changed_new n on n.id = o.id
             where o.status <> 'active' and n.status = 'active'));
  end if;
  return null;
end;
$$;

create or replace function public.admin_delete_comment(p_comment_id uuid)
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
     set status = 'deleted', moderation_removed_at = now()
   where (c.id = p_comment_id or c.parent_comment_id = p_comment_id) and c.status = 'active';
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.moderation_queue_close('comment', p_comment_id, v_actor);
  perform kc_private.audit_record(
    'manual_remove_target', 'comment', p_comment_id, jsonb_build_object('post_id', v_comment.post_id), v_actor);
end;
$$;
comment on function public.admin_delete_comment(uuid) is 'Staff: deletes a comment and its replies; audited and restorable.';

-- Brings back a comment staff removed, with the replies that removal took; dismisses the
-- open reports on it. A reply comes back only under a live comment. Idempotent on a live
-- comment. Errors: forbidden (42501); P0001 — target_not_found, invalid_restore_state (the
-- comment was deleted by its author or the post owner, or its parent is gone).
create function public.admin_restore_comment(p_comment_id uuid)
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
  if v_comment.status = 'active' then
    return;
  end if;
  if v_comment.moderation_removed_at is null or exists (
       select 1 from public.post_comments p where p.id = v_comment.parent_comment_id and p.status <> 'active') then
    raise exception 'invalid_restore_state' using errcode = 'P0001';
  end if;

  perform set_config('kc.fsm_role', 'admin', true);
  update public.post_comments c
     set status = 'active', moderation_removed_at = null
   where c.id = p_comment_id
      or (c.parent_comment_id = p_comment_id and c.moderation_removed_at = v_comment.moderation_removed_at);
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.audit_record('restore_target', 'comment', p_comment_id,
                                  jsonb_build_object('post_id', v_comment.post_id), v_actor);
  perform kc_private.report_dismiss_open('comment', p_comment_id, v_actor);
end;
$$;
comment on function public.admin_restore_comment(uuid) is
  'Staff: restores a comment staff removed, with its replies removed alongside; open reports are dismissed.';
grant execute on function public.admin_restore_comment(uuid) to authenticated;

-- ── 5. The reports inbox (FR-ADMIN-012) ───────────────────────────────────────────────────

-- One page of open report cases, oldest case first (AC4). A case is one target; the counts
-- cover all its open reports. Filters keep whole cases: by target type, cases with an open
-- report in the last p_max_age_days, cases with an open report by p_reporter_id, and a search
-- text that is either a target id or part of an open reporter's display name (AC3).
-- `target_hidden_at` is when a chat was hidden for review (null for other targets).
-- The cursor is the last case of the previous page. Staff only.
create function public.admin_reports_inbox(
  p_target_type text default null,
  p_max_age_days integer default null,
  p_reporter_id uuid default null,
  p_search text default null,
  p_after_oldest_at timestamptz default null,
  p_after_target_type text default null,
  p_after_target_id uuid default null,
  p_limit integer default 30
)
returns table (
  target_type        text,
  target_id          uuid,
  reporter_count     integer,
  report_count       integer,
  oldest_at          timestamptz,
  latest_at          timestamptz,
  latest_reporter_id uuid,
  target_hidden_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search constant text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_search_id uuid;
begin
  perform kc_private.require_admin_role('support');
  if v_search ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_search_id := v_search::uuid;
  end if;

  return query
  with cases as (
    select r.target_type as t_type, r.target_id as t_id,
           count(distinct coalesce(r.reporter_id::text, r.id::text))::integer as reporters,
           count(*)::integer as reports,
           min(r.created_at) as oldest, max(r.created_at) as latest,
           (array_agg(r.reporter_id order by r.created_at desc, r.id desc))[1] as latest_reporter
      from public.reports r
     where r.status = 'open'
       and (p_target_type is null or r.target_type = p_target_type)
     group by r.target_type, r.target_id
  )
  select c.t_type, c.t_id, c.reporters, c.reports, c.oldest, c.latest, c.latest_reporter,
         (select ch.moderation_hidden_at from public.chats ch where c.t_type = 'chat' and ch.id = c.t_id)
    from cases c
   where (p_max_age_days is null
          or c.latest >= now() - make_interval(days => least(greatest(p_max_age_days, 1), 3650)))
     and (p_reporter_id is null or exists (
            select 1 from public.reports r
             where r.target_type = c.t_type and r.target_id = c.t_id and r.status = 'open'
               and r.reporter_id = p_reporter_id))
     and (v_search is null or c.t_id = v_search_id or (v_search_id is null and exists (
            select 1 from public.reports r join public.users u on u.id = r.reporter_id
             where r.target_type = c.t_type and r.target_id = c.t_id and r.status = 'open'
               and position(v_search in lower(coalesce(u.display_name, ''))) > 0)))
     and (p_after_oldest_at is null
          or (c.oldest, c.t_type, c.t_id) > (p_after_oldest_at, coalesce(p_after_target_type, ''),
                                             coalesce(p_after_target_id, '00000000-0000-0000-0000-000000000000'::uuid)))
   order by c.oldest, c.t_type, c.t_id
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
comment on function public.admin_reports_inbox(text, integer, uuid, text, timestamptz, text, uuid, integer) is
  'Staff: open report cases, oldest first, grouped and keyset paged on the server; searchable by target id or reporter name.';
grant execute on function public.admin_reports_inbox(text, integer, uuid, text, timestamptz, text, uuid, integer)
  to authenticated;

-- ── 6. The case timeline (FR-ADMIN-013 AC1) ───────────────────────────────────────────────

-- The newest p_limit audit events of a reported target, oldest first: what was done to the
-- target and to each of its reports, by anyone. Only for a target that has been reported, so
-- it is no general window onto the audit trail. Staff only. Errors: forbidden (42501);
-- P0001 — case_not_found.
create function public.admin_report_case_timeline(
  p_target_type text,
  p_target_id uuid,
  p_limit integer default 100
)
returns table (
  id          bigint,
  occurred_at timestamptz,
  actor_id    uuid,
  action      text,
  target_type text,
  target_id   uuid,
  metadata    jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('support');
  if not exists (select 1 from public.reports r where r.target_type = p_target_type and r.target_id = p_target_id) then
    raise exception 'case_not_found' using errcode = 'P0001';
  end if;

  return query
  select t.* from (
    select e.id, e.occurred_at, e.actor_id, e.action, e.target_type, e.target_id, e.metadata
      from audit.events e
     where e.target_id = p_target_id
        or (e.target_type = 'report' and e.target_id in (
              select r.id from public.reports r where r.target_type = p_target_type and r.target_id = p_target_id))
     order by e.occurred_at desc, e.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200)) t
   order by t.occurred_at, t.id;
end;
$$;
comment on function public.admin_report_case_timeline(text, uuid, integer) is
  'Staff: the audit history of a reported target and its reports, oldest first, whoever acted.';
grant execute on function public.admin_report_case_timeline(text, uuid, integer) to authenticated;

-- ── 7. Member audit lookup (FR-ADMIN-007) ─────────────────────────────────────────────────

-- The events a member performed or that were about them, newest first, keyset paged, at most
-- 200 per page (AC2). Super admin only. Errors: forbidden (42501).
create function public.admin_audit_lookup(
  p_user_id uuid,
  p_before_occurred_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 200
)
returns table (
  id          bigint,
  occurred_at timestamptz,
  actor_id    uuid,
  action      text,
  target_type text,
  target_id   uuid,
  metadata    jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('super_admin');
  return query
  select e.id, e.occurred_at, e.actor_id, e.action, e.target_type, e.target_id, e.metadata
    from audit.events e
   where (e.actor_id = p_user_id or e.target_id = p_user_id)
     and (p_before_occurred_at is null
          or (e.occurred_at, e.id) < (p_before_occurred_at, coalesce(p_before_id, 9223372036854775807)))
   order by e.occurred_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 200);
end;
$$;
comment on function public.admin_audit_lookup(uuid, timestamptz, bigint, integer) is
  'Super admin: audit events performed by or about a member, newest first, keyset paged.';
grant execute on function public.admin_audit_lookup(uuid, timestamptz, bigint, integer) to authenticated;
