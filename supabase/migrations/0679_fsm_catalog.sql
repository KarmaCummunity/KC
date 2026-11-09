-- 0676_fsm_catalog — FSM kernel catalog and admin-task enforcement.

begin;

-- ── Catalog tables ────────────────────────────────────────────────────────────
create table public.fsm_state (
  machine_id text not null,
  status     text not null,
  primary key (machine_id, status)
);

create table public.fsm_edge (
  machine_id  text not null,
  from_status text not null,
  to_status   text not null,
  role        text not null default '',
  primary key (machine_id, from_status, to_status, role),
  foreign key (machine_id, from_status) references public.fsm_state (machine_id, status),
  foreign key (machine_id, to_status)   references public.fsm_state (machine_id, status)
);

alter table public.fsm_state enable row level security;
alter table public.fsm_edge enable row level security;

-- Explicit deny-all policies: the RLS lint wants every RLS table to carry one. Clients never
-- read the catalog; only SECURITY DEFINER functions (and the service role) do.
drop policy if exists fsm_state_deny_all on public.fsm_state;
create policy fsm_state_deny_all on public.fsm_state
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists fsm_edge_deny_all on public.fsm_edge;
create policy fsm_edge_deny_all on public.fsm_edge
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.fsm_state from public, anon, authenticated;
revoke all on table public.fsm_edge from public, anon, authenticated;

insert into public.fsm_state (machine_id, status) values
  ('admin_task', 'open'),
  ('admin_task', 'in_progress'),
  ('admin_task', 'blocked'),
  ('admin_task', 'done'),
  ('admin_task', 'archived');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
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

-- ── fsm_assert_transition ───────────────────────────────────────────────────
create or replace function public.fsm_assert_transition(
  p_machine text,
  p_from text,
  p_to text,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_exists boolean;
  v_to_exists boolean;
  v_unrestricted boolean;
  v_role_match boolean;
  v_any_edge boolean;
begin
  select exists(
    select 1 from public.fsm_state
     where machine_id = p_machine and status = p_from
  ) into v_from_exists;
  select exists(
    select 1 from public.fsm_state
     where machine_id = p_machine and status = p_to
  ) into v_to_exists;

  if not v_from_exists or not v_to_exists then
    raise exception 'unknown_state' using errcode = 'P0001';
  end if;

  if p_from = p_to then
    return;
  end if;

  select exists(
    select 1 from public.fsm_edge
     where machine_id = p_machine
       and from_status = p_from
       and to_status = p_to
       and role = ''
  ) into v_unrestricted;

  if v_unrestricted then
    return;
  end if;

  if p_role is not null then
    select exists(
      select 1 from public.fsm_edge
       where machine_id = p_machine
         and from_status = p_from
         and to_status = p_to
         and role = p_role
    ) into v_role_match;

    if v_role_match then
      return;
    end if;
  end if;

  select exists(
    select 1 from public.fsm_edge
     where machine_id = p_machine
       and from_status = p_from
       and to_status = p_to
  ) into v_any_edge;

  if v_any_edge then
    raise exception 'forbidden_role' using errcode = 'P0001';
  end if;

  raise exception 'illegal_transition' using errcode = 'P0001';
end;
$$;

revoke execute on function public.fsm_assert_transition(text, text, text, text) from public, anon, authenticated;

-- ── admin_task_set_status (catalog-backed transitions) ────────────────────────
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
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_new_status not in ('open','in_progress','blocked','done','archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_curr from public.admin_tasks where task_id = p_task_id for update;
  if v_curr.task_id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  if not public.has_admin_role(v_actor, 'super_admin')
     and v_curr.created_by <> v_actor
     and (v_curr.assignee_id is null or v_curr.assignee_id <> v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_curr.status = p_new_status then
    return;
  end if;

  begin
    perform public.fsm_assert_transition('admin_task', v_curr.status, p_new_status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'illegal_transition' then
        raise exception 'invalid_transition' using errcode = '22023';
      elsif sqlerrm = 'unknown_state' then
        raise exception 'invalid_status' using errcode = '22023';
      else
        raise;
      end if;
  end;

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
grant execute on function public.admin_task_set_status(uuid, text) to authenticated;

-- ── admin_tasks status trigger ────────────────────────────────────────────────
create or replace function public.admin_tasks_assert_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    perform public.fsm_assert_transition('admin_task', old.status, new.status, null);
  end if;
  return new;
end;
$$;

revoke all on function public.admin_tasks_assert_status_transition() from public, anon, authenticated;

drop trigger if exists admin_tasks_status_fsm on public.admin_tasks;
create trigger admin_tasks_status_fsm
  before update of status on public.admin_tasks
  for each row execute function public.admin_tasks_assert_status_transition();

commit;
