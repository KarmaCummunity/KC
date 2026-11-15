-- Back office · admin tasks (FR-ADMIN-018)
--
-- The staff task tracker: a task with a title, priority, category, labels, due date and an
-- assignee who is platform staff, and an append-only activity log (comments and every field
-- change). The tables live in kc_private with forced RLS and no policies; the public RPCs
-- below are the only way in (target design §3.7).
--
-- Who may do what (rank-based platform roles, kc_private.require_admin_role):
--   support and above   create, list, read, comment
--   creator or assignee edit fields and move the status; a super admin may edit any task
--   moderator and above assign or unassign
--   creator             delete; a super admin may delete any task
--
-- Side effects: `task_assigned` notification to a new assignee (not to the actor), and an
-- audit event on topic `audit` for create, update, status, assign and delete (ids only;
-- the title stays in the activity log). Comments are not audited.
--
-- Errors (P0001 unless noted): invalid_title, title_too_long, invalid_priority,
-- invalid_category, invalid_status, invalid_transition, invalid_input, task_not_found,
-- assignee_not_admin, empty_comment, comment_too_long; forbidden is 42501.

-- ── State machine ───────────────────────────────────────────────────────────
-- `archived` is terminal. No edge is role-restricted: the RPC decides who may move a task.
insert into kc_private.fsm_state (machine_id, status) values
  ('admin_task', 'open'), ('admin_task', 'in_progress'), ('admin_task', 'blocked'),
  ('admin_task', 'done'), ('admin_task', 'archived');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('admin_task', 'open', 'in_progress', ''),
  ('admin_task', 'open', 'blocked', ''),
  ('admin_task', 'in_progress', 'open', ''),
  ('admin_task', 'in_progress', 'blocked', ''),
  ('admin_task', 'in_progress', 'done', ''),
  ('admin_task', 'blocked', 'open', ''),
  ('admin_task', 'blocked', 'in_progress', ''),
  ('admin_task', 'blocked', 'done', ''),
  ('admin_task', 'done', 'in_progress', ''),
  ('admin_task', 'done', 'archived', '');

-- ── Notification kind ───────────────────────────────────────────────────────
-- The body interpolates the task title (`data.task_title` → `{{taskTitle}}`).
insert into kc_private.notification_kinds (kind, category, sends_push, title_key, body_key)
values ('task_assigned', 'social', true, 'notifications.taskAssignedTitle', 'notifications.taskAssignedBody');

-- ── Staff predicate for another member ──────────────────────────────────────
-- True when the member is active and holds an active platform grant of the role or of a more
-- senior platform role: the twin of kc_access.has_admin_role for a member other than the caller.
create function kc_private.user_has_platform_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_role_grants g
      join kc_private.admin_roles r on r.role = g.role and r.is_platform
      join public.users u on u.id = g.user_id and u.is_active
     where g.user_id = p_user_id
       and g.revoked_at is null
       and r.rank >= (select t.rank from kc_private.admin_roles t where t.role = p_role and t.is_platform));
$$;
comment on function kc_private.user_has_platform_role(uuid, text) is
  'The member is active and holds this platform role or a more senior one.';

-- ── Tables ──────────────────────────────────────────────────────────────────
create table kc_private.admin_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  status      text not null default 'open',
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  category    text not null default 'other' check (category in
                ('moderation', 'support', 'engineering', 'product', 'operations', 'marketing', 'finance', 'other')),
  assignee_id uuid references public.users (id) on delete set null,
  -- Nullable so that purging the creator's account keeps the task.
  created_by  uuid references public.users (id) on delete set null,
  due_at      timestamptz,
  labels      text[] not null default '{}' check (cardinality(labels) <= 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table kc_private.admin_tasks is 'Staff task tracker (FR-ADMIN-018). Reached only through the admin_task_* RPCs.';

-- The list's sort and keyset (status rank, due date with no date last, newest first).
create index admin_tasks_list_idx on kc_private.admin_tasks (status, due_at, created_at desc, id);
create index admin_tasks_assignee_idx on kc_private.admin_tasks (assignee_id) where assignee_id is not null;
create index admin_tasks_created_by_idx on kc_private.admin_tasks (created_by) where created_by is not null;
create index admin_tasks_labels_idx on kc_private.admin_tasks using gin (labels);

alter table kc_private.admin_tasks enable row level security;
alter table kc_private.admin_tasks force row level security;

create trigger admin_tasks_set_updated_at
  before update on kc_private.admin_tasks
  for each row execute function kc_private.set_updated_at();
create trigger admin_tasks_status_fsm
  before insert or update of status on kc_private.admin_tasks
  for each row execute function kc_private.fsm_guard_status('admin_task', 'status');

create table kc_private.admin_task_activities (
  id         uuid primary key default gen_random_uuid(),
  -- Write order: rows of one transaction share `created_at`, and the history reads in order.
  seq        bigint generated always as identity,
  task_id    uuid not null references kc_private.admin_tasks (id) on delete cascade,
  actor_id   uuid references public.users (id) on delete set null,
  kind       text not null check (kind in ('created', 'comment', 'status_change', 'assignment_change',
               'priority_change', 'due_change', 'title_change', 'description_change', 'labels_change',
               'category_change')),
  payload    jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
comment on table kc_private.admin_task_activities is 'Append-only history of an admin task: comments and field changes.';

create index admin_task_activities_task_idx on kc_private.admin_task_activities (task_id, seq);
create index admin_task_activities_actor_idx on kc_private.admin_task_activities (actor_id) where actor_id is not null;

alter table kc_private.admin_task_activities enable row level security;
alter table kc_private.admin_task_activities force row level security;

-- Rows are never rewritten. Deleting a task removes its history by cascade, so only UPDATE
-- is refused (the actor column is still cleared by a purge: `set null` is a referential action
-- performed as an update, so the guard lets that one change through).
create function kc_private.admin_task_activities_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_id is null and old.actor_id is not null
     and (new.id, new.seq, new.task_id, new.kind, new.payload, new.created_at)
         = (old.id, old.seq, old.task_id, old.kind, old.payload, old.created_at) then
    return new;
  end if;
  raise exception 'append_only' using errcode = 'P0001';
end;
$$;
create trigger admin_task_activities_append_only
  before update on kc_private.admin_task_activities
  for each row execute function kc_private.admin_task_activities_append_only();

-- ── Internal helpers ────────────────────────────────────────────────────────
-- Locks and returns the task; raises task_not_found.
create function kc_private.admin_task_lock(p_task_id uuid)
returns kc_private.admin_tasks
language plpgsql
set search_path = ''
as $$
declare
  v_task kc_private.admin_tasks;
begin
  select * into v_task from kc_private.admin_tasks t where t.id = p_task_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  return v_task;
end;
$$;

-- Raises forbidden unless the actor created the task, is its assignee, or is a super admin.
create function kc_private.admin_task_assert_editor(p_task kc_private.admin_tasks, p_actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor is distinct from p_task.created_by and p_actor is distinct from p_task.assignee_id
     and not kc_access.has_admin_role('super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Raises assignee_not_admin unless the member (when given) is platform staff.
create function kc_private.admin_task_assert_assignee(p_assignee_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_assignee_id is not null and not kc_private.user_has_platform_role(p_assignee_id, 'support') then
    raise exception 'assignee_not_admin' using errcode = 'P0001';
  end if;
end;
$$;

-- Validates a title (trimmed) and returns it.
create function kc_private.admin_task_clean_title(p_title text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'title_too_long' using errcode = 'P0001';
  end if;
  return btrim(p_title);
end;
$$;

-- Raises the task error code for a bad priority, category or description.
create function kc_private.admin_task_check_fields(p_priority text, p_category text, p_description text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = 'P0001';
  end if;
  if p_category is not null and p_category not in
     ('moderation', 'support', 'engineering', 'product', 'operations', 'marketing', 'finance', 'other') then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  if p_description is not null and char_length(p_description) > 4000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
end;
$$;

-- Records one audit event on the `audit` topic (ids and codes only).
create function kc_private.admin_task_audit(p_action text, p_task_id uuid, p_actor uuid, p_data jsonb)
returns void
language sql
set search_path = ''
as $$
  select kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', p_action, 'actor_id', p_actor,
    'entity', jsonb_build_object('type', 'admin_task', 'id', p_task_id), 'data', p_data));
$$;

-- Tells a new assignee about the task, unless they assigned it to themselves.
create function kc_private.admin_task_notify_assignee(p_task_id uuid, p_assignee_id uuid, p_actor uuid, p_title text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_assignee_id is null or p_assignee_id = p_actor then
    return;
  end if;
  perform kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', 'task_assigned', 'recipient_id', p_assignee_id, 'actor_id', p_actor,
    'entity', jsonb_build_object('type', 'admin_task', 'id', p_task_id),
    'data', jsonb_build_object('task_id', p_task_id, 'task_title', p_title,
                               'dedupe_key', 'task_assigned:' || p_task_id || ':' || p_assignee_id)));
end;
$$;

-- Sort rank of a status in the list: active work first.
create function kc_private.admin_task_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select array_position(array['open', 'in_progress', 'blocked', 'done', 'archived'], p_status);
$$;

-- ── Writes ──────────────────────────────────────────────────────────────────
-- Creates a task; returns its id (AC2). The creator is the caller.
create function public.admin_task_create(
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_assignee_id uuid default null,
  p_due_at timestamptz default null,
  p_labels text[] default '{}',
  p_category text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_title constant text := kc_private.admin_task_clean_title(p_title);
  v_priority constant text := coalesce(p_priority, 'medium');
  v_category constant text := coalesce(p_category, 'other');
  v_id uuid;
begin
  perform kc_private.admin_task_check_fields(v_priority, v_category, p_description);
  perform kc_private.admin_task_assert_assignee(p_assignee_id);
  insert into kc_private.admin_tasks (title, description, priority, category, assignee_id, created_by, due_at, labels)
  values (v_title, nullif(btrim(p_description), ''), v_priority, v_category, p_assignee_id, v_actor, p_due_at,
          coalesce(p_labels, '{}'))
  returning id into v_id;
  insert into kc_private.admin_task_activities (task_id, actor_id, kind, payload)
  values (v_id, v_actor, 'created', jsonb_build_object('title', v_title, 'priority', v_priority,
          'assignee_id', p_assignee_id, 'due_at', p_due_at, 'category', v_category));
  perform kc_private.admin_task_audit('admin_task_create', v_id, v_actor, jsonb_build_object(
    'assignee_id', p_assignee_id, 'category', v_category, 'priority', v_priority));
  perform kc_private.admin_task_notify_assignee(v_id, p_assignee_id, v_actor, v_title);
  return v_id;
end;
$$;
comment on function public.admin_task_create(text, text, text, uuid, timestamptz, text[], text) is
  'Staff (support+): creates an admin task, notifies the assignee and audits it.';
grant execute on function public.admin_task_create(text, text, text, uuid, timestamptz, text[], text) to authenticated;

-- Patches a task: a null argument keeps the field, an empty description clears it, and
-- `p_clear_due` removes the due date. One activity row per changed field and one audit event
-- naming the changed fields; a patch that changes nothing writes nothing.
create function public.admin_task_update(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_clear_due boolean default false,
  p_labels text[] default null,
  p_category text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_old constant kc_private.admin_tasks := kc_private.admin_task_lock(p_task_id);
  v_new kc_private.admin_tasks;
  v_changes jsonb;
begin
  perform kc_private.admin_task_assert_editor(v_old, v_actor);
  perform kc_private.admin_task_check_fields(p_priority, p_category, p_description);
  v_new := v_old;
  v_new.title := case when p_title is null then v_old.title else kc_private.admin_task_clean_title(p_title) end;
  v_new.description := case when p_description is null then v_old.description else nullif(btrim(p_description), '') end;
  v_new.priority := coalesce(p_priority, v_old.priority);
  v_new.category := coalesce(p_category, v_old.category);
  v_new.due_at := case when coalesce(p_clear_due, false) then null else coalesce(p_due_at, v_old.due_at) end;
  v_new.labels := coalesce(p_labels, v_old.labels);

  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'field', c.field, 'payload', c.payload)), '[]')
    into v_changes
    from (values
      ('title_change', 'title', v_old.title is distinct from v_new.title,
       jsonb_build_object('from', v_old.title, 'to', v_new.title)),
      ('description_change', 'description', v_old.description is distinct from v_new.description, '{}'::jsonb),
      ('priority_change', 'priority', v_old.priority is distinct from v_new.priority,
       jsonb_build_object('from', v_old.priority, 'to', v_new.priority)),
      ('category_change', 'category', v_old.category is distinct from v_new.category,
       jsonb_build_object('from', v_old.category, 'to', v_new.category)),
      ('due_change', 'due_at', v_old.due_at is distinct from v_new.due_at,
       jsonb_build_object('from', v_old.due_at, 'to', v_new.due_at)),
      ('labels_change', 'labels', v_old.labels is distinct from v_new.labels,
       jsonb_build_object('from', to_jsonb(v_old.labels), 'to', to_jsonb(v_new.labels)))
    ) as c(kind, field, changed, payload)
   where c.changed;
  if jsonb_array_length(v_changes) = 0 then
    return;
  end if;

  update kc_private.admin_tasks t
     set title = v_new.title, description = v_new.description, priority = v_new.priority,
         category = v_new.category, due_at = v_new.due_at, labels = v_new.labels
   where t.id = p_task_id;
  insert into kc_private.admin_task_activities (task_id, actor_id, kind, payload)
  select p_task_id, v_actor, c ->> 'kind', c -> 'payload' from jsonb_array_elements(v_changes) c;
  perform kc_private.admin_task_audit('admin_task_update', p_task_id, v_actor, jsonb_build_object(
    'fields', (select jsonb_agg(c -> 'field') from jsonb_array_elements(v_changes) c)));
end;
$$;
comment on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[], text) is
  'Creator, assignee or super admin: patches an admin task with one activity per changed field.';
grant execute on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[], text) to authenticated;

-- Moves a task along the `admin_task` machine. The same status again is a no-op.
create function public.admin_task_set_status(p_task_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_task constant kc_private.admin_tasks := kc_private.admin_task_lock(p_task_id);
begin
  perform kc_private.admin_task_assert_editor(v_task, v_actor);
  begin
    perform kc_private.fsm_assert_transition('admin_task', v_task.status, p_new_status);
  exception when sqlstate 'P0001' then
    raise exception '%', case when sqlerrm = 'unknown_state' then 'invalid_status' else 'invalid_transition' end
      using errcode = 'P0001';
  end;
  if p_new_status = v_task.status then
    return;
  end if;
  update kc_private.admin_tasks t set status = p_new_status where t.id = p_task_id;
  insert into kc_private.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'status_change', jsonb_build_object('from', v_task.status, 'to', p_new_status));
  perform kc_private.admin_task_audit('admin_task_status', p_task_id, v_actor,
    jsonb_build_object('from', v_task.status, 'to', p_new_status));
end;
$$;
comment on function public.admin_task_set_status(uuid, text) is
  'Creator, assignee or super admin: moves an admin task along its state machine.';
grant execute on function public.admin_task_set_status(uuid, text) to authenticated;

-- Assigns the task to a staff member, or unassigns it (null). Moderator and above.
create function public.admin_task_assign(p_task_id uuid, p_new_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_task constant kc_private.admin_tasks := kc_private.admin_task_lock(p_task_id);
begin
  if v_task.assignee_id is not distinct from p_new_assignee then
    return;
  end if;
  perform kc_private.admin_task_assert_assignee(p_new_assignee);
  update kc_private.admin_tasks t set assignee_id = p_new_assignee where t.id = p_task_id;
  insert into kc_private.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'assignment_change', jsonb_build_object('from', v_task.assignee_id, 'to', p_new_assignee));
  perform kc_private.admin_task_audit('admin_task_assign', p_task_id, v_actor,
    jsonb_build_object('from', v_task.assignee_id, 'to', p_new_assignee));
  perform kc_private.admin_task_notify_assignee(p_task_id, p_new_assignee, v_actor, v_task.title);
end;
$$;
comment on function public.admin_task_assign(uuid, uuid) is
  'Moderator and above: assigns an admin task to a staff member (null unassigns) and notifies them.';
grant execute on function public.admin_task_assign(uuid, uuid) to authenticated;

-- Adds a comment (1..4000 characters); returns the activity id. Any staff member.
create function public.admin_task_add_comment(p_task_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_id uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty_comment' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_body)) > 4000 then
    raise exception 'comment_too_long' using errcode = 'P0001';
  end if;
  perform kc_private.admin_task_lock(p_task_id);
  insert into kc_private.admin_task_activities (task_id, actor_id, kind, payload)
  values (p_task_id, v_actor, 'comment', jsonb_build_object('body', btrim(p_body)))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.admin_task_add_comment(uuid, text) is 'Staff (support+): comments on an admin task.';
grant execute on function public.admin_task_add_comment(uuid, text) to authenticated;

-- Deletes a task and its history (AC5). The creator, or a super admin.
create function public.admin_task_delete(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_task constant kc_private.admin_tasks := kc_private.admin_task_lock(p_task_id);
begin
  if v_actor is distinct from v_task.created_by and not kc_access.has_admin_role('super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from kc_private.admin_tasks t where t.id = p_task_id;
  perform kc_private.admin_task_audit('admin_task_delete', p_task_id, v_actor, '{}'::jsonb);
end;
$$;
comment on function public.admin_task_delete(uuid) is 'Creator or super admin: deletes an admin task and its history.';
grant execute on function public.admin_task_delete(uuid) to authenticated;

-- ── Reads ───────────────────────────────────────────────────────────────────
-- One row of the list and of the detail: the task with display names and its comment count.
create function kc_private.admin_task_json(p_task kc_private.admin_tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'task_id', p_task.id, 'title', p_task.title, 'description', p_task.description,
    'status', p_task.status, 'priority', p_task.priority, 'category', p_task.category,
    'assignee_id', p_task.assignee_id,
    'assignee_display_name', (select u.display_name from public.users u where u.id = p_task.assignee_id),
    'created_by', p_task.created_by,
    'created_by_display_name', (select u.display_name from public.users u where u.id = p_task.created_by),
    'due_at', p_task.due_at, 'labels', to_jsonb(p_task.labels),
    'created_at', p_task.created_at, 'updated_at', p_task.updated_at,
    'comment_count', (select count(*) from kc_private.admin_task_activities a
                       where a.task_id = p_task.id and a.kind = 'comment'));
$$;

-- The task list (AC1), keyset-paged. Sort: status rank (open, in_progress, blocked, done,
-- archived), due date ascending with no date last, then newest first. Each row carries the
-- `cursor` that continues after it. Overdue = due before now and not done or archived;
-- "only mine" = assigned to or created by the caller.
create function public.admin_task_list(
  p_status text default null,
  p_assignee uuid default null,
  p_only_mine boolean default false,
  p_overdue boolean default false,
  p_priority text default null,
  p_label text default null,
  p_category text default null,
  p_due_from timestamptz default null,
  p_due_to timestamptz default null,
  p_unassigned_only boolean default false,
  p_limit integer default 50,
  p_cursor jsonb default null
)
returns table (task jsonb, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_rank constant integer := (p_cursor ->> 'rank')::integer;
  v_due constant timestamptz := (p_cursor ->> 'due')::timestamptz;
  v_created constant timestamptz := (p_cursor ->> 'created_at')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  if p_status is not null and kc_private.admin_task_status_rank(p_status) is null then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  return query
  select kc_private.admin_task_json(t),
         jsonb_build_object('rank', k.rank, 'due', k.due, 'created_at', t.created_at, 'id', t.id)
    from kc_private.admin_tasks t
   cross join lateral (select kc_private.admin_task_status_rank(t.status) as rank,
                              coalesce(t.due_at, 'infinity'::timestamptz) as due) k
   where (p_status is null or t.status = p_status)
     and (p_assignee is null or t.assignee_id = p_assignee)
     and (not coalesce(p_unassigned_only, false) or t.assignee_id is null)
     and (not coalesce(p_only_mine, false) or v_actor in (t.assignee_id, t.created_by))
     and (not coalesce(p_overdue, false) or (t.due_at < now() and t.status not in ('done', 'archived')))
     and (p_priority is null or t.priority = p_priority)
     and (p_category is null or t.category = p_category)
     and (p_label is null or t.labels @> array[p_label])
     and (p_due_from is null or t.due_at >= p_due_from)
     and (p_due_to is null or t.due_at <= p_due_to)
     and (p_cursor is null
          or (k.rank, k.due) > (v_rank, v_due)
          or ((k.rank, k.due) = (v_rank, v_due) and (t.created_at, t.id) < (v_created, v_id)))
   order by k.rank, k.due, t.created_at desc, t.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.admin_task_list(text, uuid, boolean, boolean, text, text, text, timestamptz, timestamptz, boolean, integer, jsonb) is
  'Staff (support+): admin tasks with filters, keyset-paged by the returned cursor.';
grant execute on function public.admin_task_list(text, uuid, boolean, boolean, text, text, text, timestamptz, timestamptz, boolean, integer, jsonb)
  to authenticated;

-- One task with its history, oldest first; null when there is no such task.
create function public.admin_task_detail(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task kc_private.admin_tasks;
begin
  perform kc_private.require_admin_role('support');
  select * into v_task from kc_private.admin_tasks t where t.id = p_task_id;
  if not found then
    return null;
  end if;
  return kc_private.admin_task_json(v_task) || jsonb_build_object('activities', coalesce((
    select jsonb_agg(jsonb_build_object(
             'activity_id', a.id, 'actor_id', a.actor_id, 'actor_display_name', u.display_name,
             'kind', a.kind, 'payload', a.payload, 'created_at', a.created_at) order by a.seq)
      from kc_private.admin_task_activities a
      left join public.users u on u.id = a.actor_id
     where a.task_id = p_task_id), '[]'::jsonb));
end;
$$;
comment on function public.admin_task_detail(uuid) is 'Staff (support+): an admin task with its activity history.';
grant execute on function public.admin_task_detail(uuid) to authenticated;

-- The dashboard card: tasks still being worked on (open or in progress).
create function public.admin_task_open_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('support');
  return (select count(*) from kc_private.admin_tasks t where t.status in ('open', 'in_progress'));
end;
$$;
comment on function public.admin_task_open_count() is 'Staff (support+): the number of open and in-progress admin tasks.';
grant execute on function public.admin_task_open_count() to authenticated;
