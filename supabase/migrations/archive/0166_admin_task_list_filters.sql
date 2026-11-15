-- 0166_admin_task_list_filters — V2-ADMIN-TASKS-3 — server-side filtering
-- additions for admin_task_list: due-date range + unassigned-only.
--
-- Builds on 0161 (which added p_category). Defensively drops both the pre-0161
-- 8-arg signature AND the 0161 9-arg signature so this migration applies
-- cleanly regardless of deploy ordering between the two PRs.
--
-- Existing filters remain untouched; the new params default to NULL / false so
-- all existing callers keep working unchanged.

-- ── 1. Drop both old signatures defensively ─────────────────────────────────
drop function if exists public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int);
drop function if exists public.admin_task_list(text, uuid, boolean, boolean, text, text, int, int, text);

-- ── 2. Recreate with three new filter parameters ────────────────────────────
create or replace function public.admin_task_list(
  p_status           text default null,
  p_assignee         uuid default null,
  p_only_mine        boolean default false,
  p_overdue          boolean default false,
  p_priority         text default null,
  p_label            text default null,
  p_limit            int  default 50,
  p_offset           int  default 0,
  p_category         text default null,
  p_due_from         timestamptz default null,
  p_due_to           timestamptz default null,
  p_unassigned_only  boolean default false
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
    and (not p_unassigned_only or t.assignee_id is null)
    and (not p_only_mine or t.assignee_id = v_actor or t.created_by = v_actor)
    and (not p_overdue   or (t.due_at is not null and t.due_at < now() and t.status not in ('done','archived')))
    and (p_label    is null or p_label = any (t.labels))
    and (p_due_from is null or (t.due_at is not null and t.due_at >= p_due_from))
    and (p_due_to   is null or (t.due_at is not null and t.due_at <= p_due_to))
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

revoke execute on function public.admin_task_list(
  text, uuid, boolean, boolean, text, text, int, int, text, timestamptz, timestamptz, boolean
) from public;
grant execute on function public.admin_task_list(
  text, uuid, boolean, boolean, text, text, int, int, text, timestamptz, timestamptz, boolean
) to authenticated;
