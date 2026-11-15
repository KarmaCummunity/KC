-- 0171_timesheets — V2-ADMIN-TIME-10 — foundation for V2 §13.10 Admin Time.
--
-- Minimal personal-timesheet schema for the admin team. Each entry tracks a
-- day of work; the workflow is draft → submitted → approved | rejected.
-- Anyone with an admin role can create their own entries; super_admin +
-- moderator approve or reject.

create table if not exists public.timesheet_entries (
  entry_id      uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(user_id) on delete cascade,
  work_date     date not null,
  hours_x100    int not null check (hours_x100 between 0 and 2400),  -- 0..24h in 0.01h units
  project       text check (project is null or char_length(project) <= 200),
  description   text check (description is null or char_length(description) <= 2000),
  status        text not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected')),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.users(user_id) on delete set null,
  approval_note text check (approval_note is null or char_length(approval_note) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists timesheet_entries_user_date_idx
  on public.timesheet_entries (user_id, work_date desc) where deleted_at is null;

create index if not exists timesheet_entries_status_idx
  on public.timesheet_entries (status, submitted_at desc) where deleted_at is null;

comment on table public.timesheet_entries is
  'V2-ADMIN-TIME-10 — internal admin timesheets. Hours stored as integer hours×100 to avoid floats.';

alter table public.timesheet_entries enable row level security;

drop policy if exists timesheet_entries_select_self on public.timesheet_entries;
create policy timesheet_entries_select_self
  on public.timesheet_entries for select to authenticated
  using (user_id = auth.uid());

drop policy if exists timesheet_entries_select_approver on public.timesheet_entries;
create policy timesheet_entries_select_approver
  on public.timesheet_entries for select to authenticated
  using (
    public.has_admin_role(auth.uid(), 'super_admin')
    or public.has_admin_role(auth.uid(), 'moderator')
  );

revoke insert, update, delete on public.timesheet_entries from anon, authenticated;
grant select on public.timesheet_entries to authenticated;

create or replace function public.timesheet_entries_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists timesheet_entries_before_update_set_updated_at on public.timesheet_entries;
create trigger timesheet_entries_before_update_set_updated_at
  before update on public.timesheet_entries
  for each row execute function public.timesheet_entries_set_updated_at();

-- ── 1. list ────────────────────────────────────────────────────────────────
create or replace function public.timesheet_list(
  p_user_id   uuid    default null,
  p_status    text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_limit     int     default 100,
  p_offset    int     default 0
)
returns table (
  entry_id      uuid,
  user_id       uuid,
  user_name     text,
  work_date     date,
  hours_x100    int,
  project       text,
  description   text,
  status        text,
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid,
  approver_name text,
  approval_note text,
  created_at    timestamptz,
  updated_at    timestamptz,
  total_count   bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_is_approver boolean;
  v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_uid uuid;
  v_total bigint;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator','support']);
  v_is_approver := public.has_admin_role(v_actor, 'super_admin')
                   or public.has_admin_role(v_actor, 'moderator');
  if p_status is not null and p_status not in ('draft','submitted','approved','rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  -- Non-approvers only see their own.
  v_uid := case
    when v_is_approver then p_user_id
    else v_actor
  end;

  select count(*) into v_total
    from public.timesheet_entries e
   where e.deleted_at is null
     and (v_uid is null or e.user_id = v_uid)
     and (p_status is null or e.status = p_status)
     and (p_from is null or e.work_date >= p_from)
     and (p_to   is null or e.work_date <= p_to);

  return query
  select
    e.entry_id, e.user_id, u.display_name as user_name,
    e.work_date, e.hours_x100, e.project, e.description, e.status,
    e.submitted_at, e.approved_at, e.approved_by, ua.display_name as approver_name,
    e.approval_note, e.created_at, e.updated_at, v_total as total_count
  from public.timesheet_entries e
  left join public.users u  on u.user_id  = e.user_id
  left join public.users ua on ua.user_id = e.approved_by
  where e.deleted_at is null
    and (v_uid is null or e.user_id = v_uid)
    and (p_status is null or e.status = p_status)
    and (p_from is null or e.work_date >= p_from)
    and (p_to   is null or e.work_date <= p_to)
  order by e.work_date desc, e.created_at desc
  limit v_lim offset v_off;
end;
$$;
revoke execute on function public.timesheet_list(uuid, text, date, date, int, int) from public;
grant  execute on function public.timesheet_list(uuid, text, date, date, int, int) to authenticated;

-- ── 2. upsert (draft / re-edit own) ───────────────────────────────────────
create or replace function public.timesheet_upsert(
  p_entry_id    uuid    default null,
  p_work_date   date    default null,
  p_hours_x100  int     default null,
  p_project     text    default null,
  p_description text    default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_curr  record;
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_hours_x100 is not null and (p_hours_x100 < 0 or p_hours_x100 > 2400) then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;

  if p_entry_id is null then
    if p_work_date is null or p_hours_x100 is null then
      raise exception 'missing_required_fields' using errcode = '22023';
    end if;
    insert into public.timesheet_entries (user_id, work_date, hours_x100, project, description)
    values (v_actor, p_work_date, p_hours_x100,
            nullif(btrim(coalesce(p_project, '')), ''),
            nullif(btrim(coalesce(p_description, '')), ''))
    returning entry_id into v_id;
  else
    select * into v_curr from public.timesheet_entries
     where entry_id = p_entry_id and deleted_at is null for update;
    if v_curr.entry_id is null then
      raise exception 'entry_not_found' using errcode = 'P0002';
    end if;
    if v_curr.user_id <> v_actor then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_curr.status not in ('draft','rejected') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;
    update public.timesheet_entries
       set work_date   = coalesce(p_work_date, work_date),
           hours_x100  = coalesce(p_hours_x100, hours_x100),
           project     = case when p_project     is not null then nullif(btrim(p_project), '')     else project end,
           description = case when p_description is not null then nullif(btrim(p_description), '') else description end,
           status      = case when status = 'rejected' then 'draft' else status end
     where entry_id = p_entry_id
     returning entry_id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.timesheet_upsert(uuid, date, int, text, text) from public;
grant  execute on function public.timesheet_upsert(uuid, date, int, text, text) to authenticated;

-- ── 3. submit own draft ────────────────────────────────────────────────────
create or replace function public.timesheet_submit(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_curr record; begin
  perform admin_assert_role(v_actor, array['super_admin','moderator','support']);
  select * into v_curr from public.timesheet_entries
   where entry_id = p_entry_id and deleted_at is null for update;
  if v_curr.entry_id is null then raise exception 'entry_not_found' using errcode = 'P0002'; end if;
  if v_curr.user_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_curr.status <> 'draft' then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.timesheet_entries set status='submitted', submitted_at=now() where entry_id=p_entry_id;
end;
$$;
revoke execute on function public.timesheet_submit(uuid) from public;
grant  execute on function public.timesheet_submit(uuid) to authenticated;

-- ── 4. approve / reject (approver only) ───────────────────────────────────
create or replace function public.timesheet_decide(
  p_entry_id uuid, p_approve boolean, p_note text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_curr record; begin
  if not (public.has_admin_role(v_actor, 'super_admin') or public.has_admin_role(v_actor, 'moderator')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_curr from public.timesheet_entries
   where entry_id = p_entry_id and deleted_at is null for update;
  if v_curr.entry_id is null then raise exception 'entry_not_found' using errcode = 'P0002'; end if;
  if v_curr.status <> 'submitted' then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.timesheet_entries
     set status        = case when p_approve then 'approved' else 'rejected' end,
         approved_at   = now(),
         approved_by   = v_actor,
         approval_note = nullif(btrim(coalesce(p_note, '')), '')
   where entry_id = p_entry_id;
end;
$$;
revoke execute on function public.timesheet_decide(uuid, boolean, text) from public;
grant  execute on function public.timesheet_decide(uuid, boolean, text) to authenticated;

create or replace function public.timesheet_approve(p_entry_id uuid, p_note text default null)
returns void language sql security definer set search_path = public
as $$ select public.timesheet_decide(p_entry_id, true, p_note); $$;
revoke execute on function public.timesheet_approve(uuid, text) from public;
grant  execute on function public.timesheet_approve(uuid, text) to authenticated;

create or replace function public.timesheet_reject(p_entry_id uuid, p_note text default null)
returns void language sql security definer set search_path = public
as $$ select public.timesheet_decide(p_entry_id, false, p_note); $$;
revoke execute on function public.timesheet_reject(uuid, text) from public;
grant  execute on function public.timesheet_reject(uuid, text) to authenticated;

-- ── 5. soft delete (own drafts only) ───────────────────────────────────────
create or replace function public.timesheet_delete(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_curr record; begin
  perform admin_assert_role(v_actor, array['super_admin','moderator','support']);
  select * into v_curr from public.timesheet_entries
   where entry_id = p_entry_id and deleted_at is null;
  if v_curr.entry_id is null then raise exception 'entry_not_found' using errcode = 'P0002'; end if;
  if v_curr.user_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_curr.status not in ('draft','rejected') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.timesheet_entries set deleted_at=now() where entry_id=p_entry_id;
end;
$$;
revoke execute on function public.timesheet_delete(uuid) from public;
grant  execute on function public.timesheet_delete(uuid) to authenticated;
