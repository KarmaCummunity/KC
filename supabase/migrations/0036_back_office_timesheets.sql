-- Back office · staff timesheets (FR-ADMIN-033, product decision in docs/spec/90_decisions_log.md)
--
-- Platform staff (support and above) report their hours as entries: a draft is submitted,
-- and the reporter's direct manager decides it. The direct manager is the member holding the
-- grant that one of the reporter's active grants reports to (`admin_role_grants.manager_grant_id`,
-- FR-ADMIN-025). A super admin may decide any entry. Nobody decides their own entry.
--
-- Lifecycle (machine `timesheet`): draft → submitted → approved | rejected; editing a rejected
-- entry sends it back to draft. Approved is final. Deleting is a soft delete of a draft or a
-- rejected entry, not a status.
--
-- Visibility: a member sees their own entries, their direct reports' entries, and a super admin
-- sees every entry. Decisions and deletes are audited on topic `audit` (ids and codes only; the
-- note stays on the row).
--
-- Errors (P0001 unless noted): invalid_hours, missing_required_fields, invalid_input,
-- invalid_status, entry_not_found; forbidden is 42501.

insert into kc_private.fsm_state (machine_id, status) values
  ('timesheet', 'draft'), ('timesheet', 'submitted'), ('timesheet', 'approved'), ('timesheet', 'rejected');
-- No edge is role-restricted: the RPCs decide who may make each move.
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('timesheet', 'draft', 'submitted', ''),
  ('timesheet', 'submitted', 'approved', ''),
  ('timesheet', 'submitted', 'rejected', ''),
  ('timesheet', 'rejected', 'draft', '');

create table kc_private.timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  work_date     date not null,
  hours_x100    integer not null check (hours_x100 between 0 and 2400),
  project       text check (char_length(project) <= 200),
  description   text check (char_length(description) <= 2000),
  status        text not null default 'draft',
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.users (id) on delete set null,
  approval_note text check (char_length(approval_note) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- A decision exists exactly when the entry was decided.
  constraint timesheet_entries_decision_chk check ((approved_at is null) = (status in ('draft', 'submitted')))
);
comment on table kc_private.timesheet_entries is
  'Hours reported by platform staff (FR-ADMIN-033). Reached only through the timesheet_* RPCs.';

create index timesheet_entries_user_idx on kc_private.timesheet_entries (user_id, work_date desc, created_at desc, id desc)
  where deleted_at is null;
create index timesheet_entries_list_idx on kc_private.timesheet_entries (work_date desc, created_at desc, id desc)
  where deleted_at is null;
create index timesheet_entries_approved_by_idx on kc_private.timesheet_entries (approved_by) where approved_by is not null;

alter table kc_private.timesheet_entries enable row level security;
alter table kc_private.timesheet_entries force row level security;

create trigger timesheet_entries_set_updated_at
  before update on kc_private.timesheet_entries
  for each row execute function kc_private.set_updated_at();
create trigger timesheet_entries_status_fsm
  before insert or update of status on kc_private.timesheet_entries
  for each row execute function kc_private.fsm_guard_status('timesheet', 'status');

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- True when `p_manager` holds an active grant that an active grant of `p_reporter` reports to.
create function kc_private.is_direct_manager(p_manager uuid, p_reporter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_role_grants g
      join public.admin_role_grants mg on mg.id = g.manager_grant_id and mg.revoked_at is null
     where g.user_id = p_reporter and g.revoked_at is null and mg.user_id = p_manager);
$$;
comment on function kc_private.is_direct_manager(uuid, uuid) is
  'The first member holds an active grant that an active grant of the second reports to.';

-- May the caller decide entries of this reporter? Their direct manager or a super admin, and
-- never the reporter themselves.
create function kc_private.timesheet_can_decide(p_reporter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_reporter is distinct from auth.uid()
     and (kc_private.is_direct_manager(auth.uid(), p_reporter) or kc_access.has_admin_role('super_admin'));
$$;

-- May the caller see entries of this reporter? Their own, a direct report's, or any as super admin.
create function kc_private.timesheet_can_view(p_reporter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_reporter = auth.uid()
      or kc_private.is_direct_manager(auth.uid(), p_reporter)
      or kc_access.has_admin_role('super_admin');
$$;

-- Locks a live entry; raises entry_not_found (also for an entry the caller may not see).
create function kc_private.timesheet_lock(p_entry_id uuid)
returns kc_private.timesheet_entries
language plpgsql
set search_path = ''
as $$
declare
  v_entry kc_private.timesheet_entries;
begin
  select * into v_entry from kc_private.timesheet_entries e
   where e.id = p_entry_id and e.deleted_at is null for update;
  if not found or not kc_private.timesheet_can_view(v_entry.user_id) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  return v_entry;
end;
$$;

-- Raises invalid_status unless `p_from → p_to` is a move of the `timesheet` machine.
create function kc_private.timesheet_assert_move(p_from text, p_to text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform kc_private.fsm_assert_transition('timesheet', p_from, p_to);
exception when sqlstate 'P0001' then
  raise exception 'invalid_status' using errcode = 'P0001';
end;
$$;

-- ── Writes ──────────────────────────────────────────────────────────────────
-- Creates a draft of the caller (date and hours required) or edits one of their own drafts
-- or rejected entries; editing a rejected entry moves it back to draft. Null keeps a field
-- on edit, an empty string clears the project or the description. Returns the entry id.
create function public.timesheet_upsert(
  p_entry_id uuid default null,
  p_work_date date default null,
  p_hours_x100 integer default null,
  p_project text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_old kc_private.timesheet_entries;
  v_id uuid;
begin
  if p_hours_x100 is not null and p_hours_x100 not between 0 and 2400 then
    raise exception 'invalid_hours' using errcode = 'P0001';
  end if;
  if char_length(p_project) > 200 or char_length(p_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_entry_id is null then
    if p_work_date is null or p_hours_x100 is null then
      raise exception 'missing_required_fields' using errcode = 'P0001';
    end if;
    insert into kc_private.timesheet_entries (user_id, work_date, hours_x100, project, description)
    values (v_actor, p_work_date, p_hours_x100, nullif(btrim(p_project), ''), nullif(btrim(p_description), ''))
    returning id into v_id;
    return v_id;
  end if;

  v_old := kc_private.timesheet_lock(p_entry_id);
  if v_old.user_id <> v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kc_private.timesheet_assert_move(v_old.status, 'draft');
  update kc_private.timesheet_entries e
     set work_date = coalesce(p_work_date, e.work_date),
         hours_x100 = coalesce(p_hours_x100, e.hours_x100),
         project = case when p_project is null then e.project else nullif(btrim(p_project), '') end,
         description = case when p_description is null then e.description else nullif(btrim(p_description), '') end,
         status = 'draft', approved_at = null, approved_by = null
   where e.id = p_entry_id;
  return p_entry_id;
end;
$$;
comment on function public.timesheet_upsert(uuid, date, integer, text, text) is
  'Staff (support+): creates a draft timesheet entry or edits an own draft or rejected one.';
grant execute on function public.timesheet_upsert(uuid, date, integer, text, text) to authenticated;

-- Submits an own draft for the manager's decision.
create function public.timesheet_submit(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_entry constant kc_private.timesheet_entries := kc_private.timesheet_lock(p_entry_id);
begin
  if v_entry.user_id <> v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update kc_private.timesheet_entries e set status = 'submitted', submitted_at = now() where e.id = p_entry_id;
end;
$$;
comment on function public.timesheet_submit(uuid) is 'The author: submits a draft timesheet entry.';
grant execute on function public.timesheet_submit(uuid) to authenticated;

-- Decides a submitted entry: approved or rejected, with an optional note.
create function kc_private.timesheet_decide(p_entry_id uuid, p_status text, p_note text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_entry constant kc_private.timesheet_entries := kc_private.timesheet_lock(p_entry_id);
begin
  if not kc_private.timesheet_can_decide(v_entry.user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform kc_private.timesheet_assert_move(v_entry.status, p_status);
  if char_length(p_note) > 2000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update kc_private.timesheet_entries e
     set status = p_status, approved_at = now(), approved_by = v_actor, approval_note = nullif(btrim(p_note), '')
   where e.id = p_entry_id;
  perform kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', 'timesheet_decide', 'actor_id', v_actor,
    'entity', jsonb_build_object('type', 'timesheet_entry', 'id', p_entry_id),
    'data', jsonb_build_object('decision', p_status, 'entry_owner_id', v_entry.user_id)));
end;
$$;

create function public.timesheet_approve(p_entry_id uuid, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$ select kc_private.timesheet_decide(p_entry_id, 'approved', p_note); $$;
comment on function public.timesheet_approve(uuid, text) is
  'The reporter''s direct manager or a super admin: approves a submitted timesheet entry.';
grant execute on function public.timesheet_approve(uuid, text) to authenticated;

create function public.timesheet_reject(p_entry_id uuid, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$ select kc_private.timesheet_decide(p_entry_id, 'rejected', p_note); $$;
comment on function public.timesheet_reject(uuid, text) is
  'The reporter''s direct manager or a super admin: rejects a submitted timesheet entry.';
grant execute on function public.timesheet_reject(uuid, text) to authenticated;

-- Deletes (hides) an own draft or rejected entry.
create function public.timesheet_delete(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_entry constant kc_private.timesheet_entries := kc_private.timesheet_lock(p_entry_id);
begin
  if v_entry.user_id <> v_actor then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_entry.status not in ('draft', 'rejected') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update kc_private.timesheet_entries e set deleted_at = now() where e.id = p_entry_id;
  perform kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', 'timesheet_delete', 'actor_id', v_actor,
    'entity', jsonb_build_object('type', 'timesheet_entry', 'id', p_entry_id), 'data', '{}'::jsonb));
end;
$$;
comment on function public.timesheet_delete(uuid) is 'The author: deletes a draft or rejected timesheet entry.';
grant execute on function public.timesheet_delete(uuid) to authenticated;

-- ── Reads ───────────────────────────────────────────────────────────────────
-- True when the entry is visible to the caller and matches the list filters. Scope:
--   mine       the caller's own entries
--   to_decide  submitted entries the caller may decide
--   all        every entry the caller may see
create function kc_private.timesheet_matches(
  p_entry kc_private.timesheet_entries, p_scope text, p_user_id uuid, p_status text, p_from date, p_to date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_entry.deleted_at is null
     and kc_private.timesheet_can_view(p_entry.user_id)
     and case p_scope
           when 'mine' then p_entry.user_id = auth.uid()
           when 'to_decide' then p_entry.status = 'submitted' and kc_private.timesheet_can_decide(p_entry.user_id)
           else true end
     and (p_user_id is null or p_entry.user_id = p_user_id)
     and (p_status is null or p_entry.status = p_status)
     and (p_from is null or p_entry.work_date >= p_from)
     and (p_to is null or p_entry.work_date <= p_to);
$$;

create function kc_private.timesheet_assert_filters(p_scope text, p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_scope not in ('mine', 'to_decide', 'all')
     or (p_status is not null and p_status not in ('draft', 'submitted', 'approved', 'rejected')) then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
end;
$$;

-- Entries newest work date first, keyset-paged: each row carries the `cursor` that continues
-- after it, and `can_decide` tells the screen whether to offer approve and reject.
create function public.timesheet_list(
  p_scope text default 'mine',
  p_user_id uuid default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 100,
  p_cursor jsonb default null
)
returns table (entry jsonb, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date constant date := (p_cursor ->> 'work_date')::date;
  v_created constant timestamptz := (p_cursor ->> 'created_at')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  perform kc_private.require_active_caller();
  perform kc_private.timesheet_assert_filters(p_scope, p_status);
  return query
  select jsonb_build_object(
           'entry_id', e.id, 'user_id', e.user_id, 'user_name', u.display_name, 'work_date', e.work_date,
           'hours_x100', e.hours_x100, 'project', e.project, 'description', e.description, 'status', e.status,
           'submitted_at', e.submitted_at, 'approved_at', e.approved_at, 'approved_by', e.approved_by,
           'approver_name', a.display_name, 'approval_note', e.approval_note,
           'created_at', e.created_at, 'updated_at', e.updated_at,
           'can_decide', e.status = 'submitted' and kc_private.timesheet_can_decide(e.user_id)),
         jsonb_build_object('work_date', e.work_date, 'created_at', e.created_at, 'id', e.id)
    from kc_private.timesheet_entries e
    left join public.users u on u.id = e.user_id
    left join public.users a on a.id = e.approved_by
   where kc_private.timesheet_matches(e, p_scope, p_user_id, p_status, p_from, p_to)
     and (p_cursor is null or (e.work_date, e.created_at, e.id) < (v_date, v_created, v_id))
   order by e.work_date desc, e.created_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
comment on function public.timesheet_list(text, uuid, text, date, date, integer, jsonb) is
  'Timesheet entries the caller may see (own, direct reports, all for a super admin), keyset-paged.';
grant execute on function public.timesheet_list(text, uuid, text, date, date, integer, jsonb) to authenticated;

-- How many entries match the same filters (the screen's total).
create function public.timesheet_count(
  p_scope text default 'mine',
  p_user_id uuid default null,
  p_status text default null,
  p_from date default null,
  p_to date default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_active_caller();
  perform kc_private.timesheet_assert_filters(p_scope, p_status);
  return (select count(*) from kc_private.timesheet_entries e
           where kc_private.timesheet_matches(e, p_scope, p_user_id, p_status, p_from, p_to));
end;
$$;
comment on function public.timesheet_count(text, uuid, text, date, date) is
  'The number of timesheet entries matching the list filters.';
grant execute on function public.timesheet_count(text, uuid, text, date, date) to authenticated;
