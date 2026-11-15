-- 0165_admin_tasks_category — V2-ADMIN-TASKS-2 — add `category` field to admin_tasks.
--
-- The PRD V2 (§13.4 Admin Tasks) calls out category as a first-class attribute
-- alongside priority and assignee. Today the codebase ships `labels text[]` as
-- free-form tags. Categories are a curated, single-select dimension. Labels
-- stay as sub-tags.
--
-- Categories: moderation / support / engineering / product / operations /
--             marketing / finance / other.
--
-- Backfill: every existing row defaults to 'other'.

-- ── 1. column + check ──────────────────────────────────────────────────────
alter table public.admin_tasks
  add column if not exists category text not null default 'other';

alter table public.admin_tasks
  drop constraint if exists admin_tasks_category_chk;

alter table public.admin_tasks
  add constraint admin_tasks_category_chk check (category in (
    'moderation','support','engineering','product',
    'operations','marketing','finance','other'
  ));

create index if not exists admin_tasks_category_idx
  on public.admin_tasks (category);

comment on column public.admin_tasks.category is
  'V2-ADMIN-TASKS-2 — curated single-select category. Free-form labels stay separate.';

-- ── 2. Extend admin_task_activities.kind allow-list ─────────────────────────
alter table public.admin_task_activities
  drop constraint if exists admin_task_activities_kind_check;

alter table public.admin_task_activities
  add constraint admin_task_activities_kind_check check (kind in (
    'created',
    'comment',
    'status_change',
    'assignment_change',
    'priority_change',
    'due_change',
    'title_change',
    'description_change',
    'labels_change',
    'category_change'
  ));

-- ── 3. Recreate admin_task_create with p_category ──────────────────────────
drop function if exists public.admin_task_create(text, text, text, uuid, timestamptz, text[]);

create or replace function public.admin_task_create(
  p_title        text,
  p_description  text default null,
  p_priority     text default 'medium',
  p_assignee_id  uuid default null,
  p_due_at       timestamptz default null,
  p_labels       text[] default '{}'::text[],
  p_category     text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_task_id uuid;
  v_category text := coalesce(p_category, 'other');
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
  if v_category not in (
    'moderation','support','engineering','product',
    'operations','marketing','finance','other'
  ) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not (
    public.has_admin_role(p_assignee_id, 'super_admin')
    or public.has_admin_role(p_assignee_id, 'moderator')
    or public.has_admin_role(p_assignee_id, 'support')
  ) then
    raise exception 'assignee_not_admin' using errcode = '23514';
  end if;

  insert into public.admin_tasks (
    title, description, priority, assignee_id, created_by, due_at, labels, category
  ) values (
    p_title, p_description, p_priority, p_assignee_id, v_actor,
    p_due_at, coalesce(p_labels, '{}'::text[]), v_category
  )
  returning task_id into v_task_id;

  insert into public.admin_task_activities (task_id, actor_id, kind, payload)
  values (v_task_id, v_actor, 'created', jsonb_build_object(
    'title', p_title, 'priority', p_priority, 'assignee_id', p_assignee_id,
    'due_at', p_due_at, 'category', v_category
  ));

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_create', 'task', v_task_id,
    jsonb_build_object('title', p_title, 'assignee_id', p_assignee_id, 'category', v_category));

  perform public.admin_task_enqueue_assigned_notification(v_task_id, p_assignee_id, v_actor, p_title);

  return v_task_id;
end;
$$;

comment on function public.admin_task_create(text, text, text, uuid, timestamptz, text[], text) is
  'V2-ADMIN-TASKS-2 — create an admin task. Same as 0145 but with curated `p_category` (default ''other'').';

revoke execute on function public.admin_task_create(text, text, text, uuid, timestamptz, text[], text) from public;
grant  execute on function public.admin_task_create(text, text, text, uuid, timestamptz, text[], text) to authenticated;

-- ── 4. Recreate admin_task_update with p_category ──────────────────────────
drop function if exists public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[]);

create or replace function public.admin_task_update(
  p_task_id     uuid,
  p_title       text default null,
  p_description text default null,
  p_priority    text default null,
  p_due_at      timestamptz default null,
  p_clear_due   boolean default false,
  p_labels      text[] default null,
  p_category    text default null
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
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  select * into v_curr from public.admin_tasks where task_id = p_task_id for update;
  if v_curr.task_id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if not public.has_admin_role(v_actor, 'super_admin')
     and v_curr.created_by <> v_actor
     and (v_curr.assignee_id is null or v_curr.assignee_id <> v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_priority is not null and p_priority not in ('low','medium','high','urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if p_title is not null and (char_length(trim(p_title)) = 0 or char_length(p_title) > 200) then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in (
    'moderation','support','engineering','product',
    'operations','marketing','finance','other'
  ) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  update public.admin_tasks
     set title       = coalesce(p_title, title),
         description = case when p_description is not null then p_description else description end,
         priority    = coalesce(p_priority, priority),
         due_at      = case when p_clear_due then null when p_due_at is not null then p_due_at else due_at end,
         labels      = coalesce(p_labels, labels),
         category    = coalesce(p_category, category)
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
  if p_category is not null and p_category <> v_curr.category then
    insert into public.admin_task_activities (task_id, actor_id, kind, payload)
    values (p_task_id, v_actor, 'category_change',
            jsonb_build_object('from', v_curr.category, 'to', p_category));
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_task_update', 'task', p_task_id, jsonb_build_object('fields',
    jsonb_strip_nulls(jsonb_build_object(
      'title', p_title, 'description', p_description, 'priority', p_priority,
      'due_at', p_due_at, 'clear_due', p_clear_due, 'labels', p_labels,
      'category', p_category
    ))));
end;
$$;

revoke execute on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[], text) from public;
grant  execute on function public.admin_task_update(uuid, text, text, text, timestamptz, boolean, text[], text) to authenticated;

-- ── 5. Recreate admin_task_list with p_category filter + returned column ───
drop function if exists public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int);

create or replace function public.admin_task_list(
  p_status    text default null,
  p_assignee  uuid default null,
  p_only_mine boolean default false,
  p_overdue   boolean default false,
  p_priority  text default null,
  p_label     text default null,
  p_limit     int  default 50,
  p_offset    int  default 0,
  p_category  text default null
)
returns table (
  task_id      uuid,
  title        text,
  description  text,
  status       text,
  priority     text,
  category     text,
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
    t.task_id, t.title, t.description, t.status, t.priority, t.category, t.assignee_id,
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
    and (p_category is null or t.category = p_category)
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

revoke execute on function public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int, text) from public;
grant  execute on function public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int, text) to authenticated;

-- ── 6. Recreate admin_task_detail with returned category column ────────────
drop function if exists public.admin_task_detail(uuid);

create or replace function public.admin_task_detail(
  p_task_id uuid
)
returns table (
  task_id      uuid,
  title        text,
  description  text,
  status       text,
  priority     text,
  category     text,
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
    t.task_id, t.title, t.description, t.status, t.priority, t.category, t.assignee_id,
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
