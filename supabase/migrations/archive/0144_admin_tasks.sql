-- Migration 0144: admin_tasks + admin_task_activities tables (P3.A3, FR-ADMIN-018).
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md §13 FR-ADMIN-018.
--
-- Internal-only tasks for the admin team — never visible to end users.
-- RLS gates SELECT to active admins (super_admin / moderator / support); all
-- writes go through SECURITY DEFINER RPCs in 0145.
--
-- Activity log (`admin_task_activities`) is append-only and cascades on task
-- delete; it records comments + status/assignee/priority/due changes.
--
-- Widens audit_events.action allow-list with admin_task_create /
-- admin_task_update / admin_task_delete (dance pattern v4 -> v5, same as 0034
-- / 0075 / 0143).

-- ── 1. admin_tasks ──────────────────────────────────────────────────────────
create table public.admin_tasks (
  task_id      uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  description  text,
  status       text not null default 'open'
                 check (status in ('open','in_progress','blocked','done','archived')),
  priority     text not null default 'medium'
                 check (priority in ('low','medium','high','urgent')),
  assignee_id  uuid references public.users(user_id) on delete set null,
  created_by   uuid not null references public.users(user_id) on delete set null,
  due_at       timestamptz,
  labels       text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.admin_tasks is
  'Internal admin task tracker (FR-ADMIN-018). Never visible to end users. Writes go through SECURITY DEFINER RPCs.';

create index admin_tasks_status_idx       on public.admin_tasks (status);
create index admin_tasks_assignee_idx     on public.admin_tasks (assignee_id) where assignee_id is not null;
create index admin_tasks_priority_idx     on public.admin_tasks (priority);
create index admin_tasks_due_idx          on public.admin_tasks (due_at)      where due_at is not null;
create index admin_tasks_created_at_idx   on public.admin_tasks (created_at desc);
create index admin_tasks_labels_gin_idx   on public.admin_tasks using gin (labels);

alter table public.admin_tasks enable row level security;

create policy admin_tasks_admin_select
  on public.admin_tasks for select
  using (public.has_admin_role(auth.uid(), 'super_admin')
      or public.has_admin_role(auth.uid(), 'moderator')
      or public.has_admin_role(auth.uid(), 'support'));

-- All writes via SECURITY DEFINER RPCs in 0145.
revoke insert, update, delete on public.admin_tasks from anon, authenticated;
grant select on public.admin_tasks to authenticated;

-- ── 2. updated_at trigger ───────────────────────────────────────────────────
create or replace function public.admin_tasks_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger admin_tasks_before_update_set_updated_at
  before update on public.admin_tasks
  for each row execute function public.admin_tasks_set_updated_at();

-- ── 3. admin_task_activities ────────────────────────────────────────────────
create table public.admin_task_activities (
  activity_id  uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.admin_tasks(task_id) on delete cascade,
  actor_id     uuid references public.users(user_id) on delete set null,
  kind         text not null
                 check (kind in (
                   'created',
                   'comment',
                   'status_change',
                   'assignment_change',
                   'priority_change',
                   'due_change',
                   'title_change',
                   'description_change',
                   'labels_change'
                 )),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.admin_task_activities is
  'Append-only per-task activity log. Cascades on admin_tasks delete (AC5 hard delete).';

create index admin_task_activities_task_chrono_idx
  on public.admin_task_activities (task_id, created_at desc);

alter table public.admin_task_activities enable row level security;

create policy admin_task_activities_admin_select
  on public.admin_task_activities for select
  using (public.has_admin_role(auth.uid(), 'super_admin')
      or public.has_admin_role(auth.uid(), 'moderator')
      or public.has_admin_role(auth.uid(), 'support'));

revoke insert, update, delete on public.admin_task_activities from anon, authenticated;
grant select on public.admin_task_activities to authenticated;

-- ── 4. Widen audit_events.action allow-list ─────────────────────────────────
alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check_v5 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self',
    'admin_role_grant','admin_role_revoke',
    'admin_task_create','admin_task_update','admin_task_delete'
  )) not valid;

alter table public.audit_events validate constraint audit_events_action_check_v5;
alter table public.audit_events
  rename constraint audit_events_action_check_v5 to audit_events_action_check;
