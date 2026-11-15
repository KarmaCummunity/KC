-- Migration 0145: Admin Tasks tracker RPCs (P3.A3, FR-ADMIN-018).
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md §13.
--
-- Ships 8 SECURITY DEFINER RPCs for the internal admin tasks tracker:
--   admin_task_create / admin_task_update / admin_task_set_status /
--   admin_task_assign / admin_task_add_comment / admin_task_delete /
--   admin_task_list  / admin_task_detail
--
-- Auth model per PERMISSION_MATRIX §3.6 in the design doc:
--   create/comment/list/detail/set_status (own): super_admin + moderator + support
--   update content (own):                       super_admin + moderator + support (must be creator or assignee)
--   set_status (any task):                      super_admin
--   assign:                                     super_admin + moderator
--   delete:                                     super_admin + creator-only (FR-ADMIN-018 AC5)
--
-- Notifications: admin_task_assign + admin_task_create-with-assignee enqueue a
-- 'task_assigned' row into notifications_outbox so the assignee gets a push +
-- in-app notification (FR-ADMIN-018 AC6). dispatch-notification i18n keys
-- 'notifications.taskAssignedTitle' / 'Body' are added to
-- supabase/functions/dispatch-notification/i18n.json in this same PR.
--
-- Status FSM (FR-ADMIN-018 AC4):
--   open         -> in_progress, blocked
--   in_progress  -> open, blocked, done
--   blocked      -> open, in_progress, done
--   done         -> in_progress, archived
--   archived     -> (terminal)

-- ── 1. helper: is the user permitted to mutate this task? ──────────────────
create or replace function public.admin_task_is_owner_or_assignee(
  p_task_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_tasks
    where task_id = p_task_id
      and (created_by = p_user_id or assignee_id = p_user_id)
  );
$$;

revoke execute on function public.admin_task_is_owner_or_assignee(uuid, uuid) from public;
grant  execute on function public.admin_task_is_owner_or_assignee(uuid, uuid) to authenticated;

-- ── 2. helper: enqueue task_assigned notification ──────────────────────────
create or replace function public.admin_task_enqueue_assigned_notification(
  p_task_id     uuid,
  p_assignee_id uuid,
  p_actor_id    uuid,
  p_title       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_assignee_id is null or p_assignee_id = p_actor_id then
    return;
  end if;
  perform public.enqueue_notification(
    p_assignee_id,
    'social',
    'task_assigned',
    'notifications.taskAssignedTitle',
    'notifications.taskAssignedBody',
    jsonb_build_object('title', p_title),
    jsonb_build_object('task_id', p_task_id, 'route', '/(admin)/tasks/' || p_task_id::text),
    'task_assigned:' || p_task_id::text || ':' || p_assignee_id::text,
    false
  );
exception
  when undefined_function then
    null;
end;
$$;

revoke execute on function public.admin_task_enqueue_assigned_notification(uuid, uuid, uuid, text) from public;

-- ── 3. admin_task_create ────────────────────────────────────────────────────
create or replace function public.admin_task_create(
  p_title        text,
  p_description  text default null,
  p_priority     text default 'medium',
  p_assignee_id  uuid default null,
  p_due_at       timestamptz default null,
  p_labels       text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_task_id uuid;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if char_length(p_title) > 200 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if p_priority not in ('low','medium','high','urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not (
    public.has_admin_role(p_assignee_id, 'super_admin')
    or public.has_admin_role(p_assignee_id, 'moderator')
    or public.has_admin_role(p_assignee_id, 'support')
  ) then
    raise exception 'assignee_not_admin' using errcode = '23514';
  end if;

  insert into public.admin_tasks (
    title, description, priority, assignee_id, created_by, due_at, labels
  ) values (
    p_title, p_description, p_priority, p_assignee_id, v_actor, p_due_at, coalesce(p_labels, '{}'::text[])
  )
  returning task_id into v_task_id;

  insert into public.admin_task_activities (task_id, actor_id, kind, payload)
  values (v_task_id, v_actor, 'created', jsonb_build_object(
    'title', p_title, 'priority', p_priority, 'assignee_id', p_assignee_id, 'due_at', p_due_at
  ));

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_create', 'task', v_task_id,
    jsonb_build_object('title', p_title, 'assignee_id', p_assignee_id));

  perform public.admin_task_enqueue_assigned_notification(v_task_id, p_assignee_id, v_actor, p_title);

  return v_task_id;
end;
$$;

comment on function public.admin_task_create(text, text, text, uuid, timestamptz, text[]) is
  'Create an admin task. Caller must be super_admin/moderator/support. Assignee must be an active admin.';

revoke execute on function public.admin_task_create(text, text, text, uuid, timestamptz, text[]) from public;
grant  execute on function public.admin_task_create(text, text, text, uuid, timestamptz, text[]) to authenticated;

-- ── 4. admin_task_update ────────────────────────────────────────────────────
create or replace function public.admin_task_update(
  p_task_id     uuid,
  p_title       text default null,
  p_description text default null,
  p_priority    text default null,
  p_due_at      timestamptz default null,
  p_clear_due   boolean default false,
  p_labels      text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_curr    record;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  select * into v_curr from public.admin_tasks where task_id = p_task_id for update;
  if v_curr.task_id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if not public.has_admin_role(v_actor, 'super_admin')
     and v_curr.created_by <> v_actor and (v_curr.assignee_id is null or v_curr.assignee_id <> v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_priority is not null and p_priority not in ('low','medium','high','urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if p_title is not null and (char_length(trim(p_title)) = 0 or char_length(p_title) > 200) then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  update public.admin_tasks
     set title       = coalesce(p_title, title),
         description = case when p_description is not null then p_description else description end,
         priority    = coalesce(p_priority, priority),
         due_at      = case when p_clear_due then null when p_due_at is not null then p_due_at else due_at end,
         labels      = coalesce(p_labels, labels)
   where task_id = p_task_id;

  if p_title is not null and p_title <> v_curr.title then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'title_change',
            jsonb_build_object('from', v_curr.title, 'to', p_title));
  end if;
  if p_priority is not null and p_priority <> v_curr.priority then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'priority_change',
            jsonb_build_object('from', v_curr.priority, 'to', p_priority));
  end if;
  if (p_due_at is not null and p_due_at is distinct from v_curr.due_at)
     or (p_clear_due and v_curr.due_at is not null) then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'due_change',
            jsonb_build_object('from', v_curr.due_at,
                               'to', case when p_clear_due then null else p_due_at end));
  end if;
  if p_labels is not null and p_labels <> v_curr.labels then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'labels_change',
            jsonb_build_object('from', v_curr.labels, 'to', p_labels));
  end if;
  if p_description is not null and p_description is distinct from v_curr.description then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'description_change', '{}'::jsonb);
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_update', 'task', p_task_id, jsonb_build_object('fields',
    jsonb_strip_nulls(jsonb_build_object(
      'title', p_title, 'description', p_description, 'priority', p_priority,
      'due_at', p_due_at, 'clear_due', p_clear_due, 'labels', p_labels
    ))));
end;
$$;

revoke execute on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[]) from public;
grant  execute on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[]) to authenticated;

-- ── 5. admin_task_set_status (with FSM transition guard) ───────────────────
create or replace function public.admin_task_set_status(
  p_task_id    uuid,
  p_new_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_curr  record;
  v_allowed_transitions text[][];
  v_pair text;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_new_status not in ('open','in_progress','blocked','done','archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_curr from public.admin_tasks where task_id = p_task_id for update;
  if v_curr.task_id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  -- AC4 auth: super_admin always; otherwise must be assignee or creator;
  -- support has no special exemption but can still move own/assigned tasks.
  if not public.has_admin_role(v_actor, 'super_admin')
     and v_curr.created_by <> v_actor
     and (v_curr.assignee_id is null or v_curr.assignee_id <> v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_curr.status = p_new_status then
    return; -- idempotent no-op
  end if;

  v_pair := v_curr.status || '->' || p_new_status;
  if v_pair not in (
    'open->in_progress','open->blocked',
    'in_progress->open','in_progress->blocked','in_progress->done',
    'blocked->open','blocked->in_progress','blocked->done',
    'done->in_progress','done->archived'
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.admin_tasks set status = p_new_status where task_id = p_task_id;

  insert into public.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'status_change',
          jsonb_build_object('from', v_curr.status, 'to', p_new_status));

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_update', 'task', p_task_id,
          jsonb_build_object('status_change', jsonb_build_object('from', v_curr.status, 'to', p_new_status)));
end;
$$;

revoke execute on function public.admin_task_set_status(uuid, text) from public;
grant  execute on function public.admin_task_set_status(uuid, text) to authenticated;

-- ── 6. admin_task_assign ────────────────────────────────────────────────────
create or replace function public.admin_task_assign(
  p_task_id      uuid,
  p_new_assignee uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_curr  record;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator']);

  select * into v_curr from public.admin_tasks where task_id = p_task_id for update;
  if v_curr.task_id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if p_new_assignee is not null and not (
    public.has_admin_role(p_new_assignee, 'super_admin')
    or public.has_admin_role(p_new_assignee, 'moderator')
    or public.has_admin_role(p_new_assignee, 'support')
  ) then
    raise exception 'assignee_not_admin' using errcode = '23514';
  end if;

  if v_curr.assignee_id is not distinct from p_new_assignee then
    return; -- no-op
  end if;

  update public.admin_tasks set assignee_id = p_new_assignee where task_id = p_task_id;

  insert into public.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'assignment_change',
          jsonb_build_object('from', v_curr.assignee_id, 'to', p_new_assignee));

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_update', 'task', p_task_id,
          jsonb_build_object('assignment_change',
            jsonb_build_object('from', v_curr.assignee_id, 'to', p_new_assignee)));

  perform public.admin_task_enqueue_assigned_notification(p_task_id, p_new_assignee, v_actor, v_curr.title);
end;
$$;

revoke execute on function public.admin_task_assign(uuid, uuid) from public;
grant  execute on function public.admin_task_assign(uuid, uuid) to authenticated;

-- ── 7. admin_task_add_comment ───────────────────────────────────────────────
create or replace function public.admin_task_add_comment(
  p_task_id uuid,
  p_body    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_activity_id uuid;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'empty_comment' using errcode = '22023';
  end if;
  if char_length(p_body) > 4000 then
    raise exception 'comment_too_long' using errcode = '22023';
  end if;

  if not exists (select 1 from public.admin_tasks where task_id = p_task_id) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  insert into public.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'comment', jsonb_build_object('body', p_body))
  returning activity_id into v_activity_id;

  return v_activity_id;
end;
$$;

revoke execute on function public.admin_task_add_comment(uuid, text) from public;
grant  execute on function public.admin_task_add_comment(uuid, text) to authenticated;

-- ── 8. admin_task_delete (creator + super_admin only) ──────────────────────
create or replace function public.admin_task_delete(
  p_task_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_created_by uuid;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  select created_by into v_created_by from public.admin_tasks where task_id = p_task_id;
  if v_created_by is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if not public.has_admin_role(v_actor, 'super_admin') and v_created_by <> v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.admin_tasks where task_id = p_task_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_delete', 'task', p_task_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_task_delete(uuid) from public;
grant  execute on function public.admin_task_delete(uuid) to authenticated;

-- ── 9. admin_task_list (filtered) ──────────────────────────────────────────
create or replace function public.admin_task_list(
  p_status    text default null,
  p_assignee  uuid default null,
  p_only_mine boolean default false,
  p_overdue   boolean default false,
  p_priority  text default null,
  p_label     text default null,
  p_limit     int  default 50,
  p_offset    int  default 0
)
returns table (
  task_id      uuid,
  title        text,
  description  text,
  status       text,
  priority     text,
  assignee_id  uuid,
  assignee_display_name text,
  created_by   uuid,
  created_by_display_name text,
  due_at       timestamptz,
  labels       text[],
  created_at   timestamptz,
  updated_at   timestamptz,
  comment_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  return query
  select
    t.task_id, t.title, t.description, t.status, t.priority, t.assignee_id,
    ua.display_name as assignee_display_name,
    t.created_by, uc.display_name as created_by_display_name,
    t.due_at, t.labels, t.created_at, t.updated_at,
    (select count(*)::int from public.admin_task_activities a
       where a.task_id = t.task_id and a.kind = 'comment') as comment_count
  from public.admin_tasks t
  left join public.users ua on ua.user_id = t.assignee_id
  left join public.users uc on uc.user_id = t.created_by
  where (p_status   is null or t.status   = p_status)
    and (p_priority is null or t.priority = p_priority)
    and (p_assignee is null or t.assignee_id = p_assignee)
    and (not p_only_mine or t.assignee_id = v_actor or t.created_by = v_actor)
    and (not p_overdue   or (t.due_at is not null and t.due_at < now() and t.status not in ('done','archived')))
    and (p_label is null or p_label = any (t.labels))
  order by
    case when t.status = 'open'        then 0
         when t.status = 'in_progress' then 1
         when t.status = 'blocked'     then 2
         when t.status = 'done'        then 3
         else 4 end,
    case when t.due_at is null then 1 else 0 end,
    t.due_at asc nulls last,
    t.created_at desc
  limit v_lim offset v_off;
end;
$$;

revoke execute on function public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int) from public;
grant  execute on function public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int) to authenticated;

-- ── 10. admin_task_detail (task + activities joined) ───────────────────────
create or replace function public.admin_task_detail(
  p_task_id uuid
)
returns table (
  task_id      uuid,
  title        text,
  description  text,
  status       text,
  priority     text,
  assignee_id  uuid,
  assignee_display_name text,
  created_by   uuid,
  created_by_display_name text,
  due_at       timestamptz,
  labels       text[],
  created_at   timestamptz,
  updated_at   timestamptz,
  activities   jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  return query
  select
    t.task_id, t.title, t.description, t.status, t.priority, t.assignee_id,
    ua.display_name as assignee_display_name,
    t.created_by, uc.display_name as created_by_display_name,
    t.due_at, t.labels, t.created_at, t.updated_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'activity_id', a.activity_id,
                'actor_id',    a.actor_id,
                'actor_display_name', uact.display_name,
                'kind',        a.kind,
                'payload',     a.payload,
                'created_at',  a.created_at
              ) order by a.created_at asc)
         from public.admin_task_activities a
         left join public.users uact on uact.user_id = a.actor_id
         where a.task_id = t.task_id),
      '[]'::jsonb
    ) as activities
  from public.admin_tasks t
  left join public.users ua on ua.user_id = t.assignee_id
  left join public.users uc on uc.user_id = t.created_by
  where t.task_id = p_task_id;
end;
$$;

revoke execute on function public.admin_task_detail(uuid) from public;
grant  execute on function public.admin_task_detail(uuid) to authenticated;
