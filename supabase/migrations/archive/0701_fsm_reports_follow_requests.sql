-- 0701_fsm_reports_follow_requests | Wave 4a of the FSM kernel program (#1989, G61)
--
-- Two small lifecycles move onto the kernel (0680), with unchanged behavior:
--
-- 1. `reports.status` (machine `report`): open → confirmed_violation | dismissed_no_violation,
--    both final. `reports_on_status_change` (0005) held this graph as hand-written checks; it now
--    asks the kernel and keeps its error codes, the resolved_at / resolved_by stamps and its name,
--    so the trigger `reports_before_update_status` and its callers are unchanged.
-- 2. `follow_requests.status` (machine `follow_request`): pending → accepted | rejected |
--    cancelled, all final. Only the RLS policies (0003) held it, so a server writer (the block
--    cleanup, the auto-accept on going public, the service role) could move a resolved request.
--    `follow_requests_status_fsm` now guards every writer. Who may take which move stays in the
--    RLS policies until writer roles reach the kernel (wave 1c).

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('report', 'open'),
  ('report', 'confirmed_violation'),
  ('report', 'dismissed_no_violation');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('report', 'open', 'confirmed_violation', ''),
  ('report', 'open', 'dismissed_no_violation', '');

insert into public.fsm_state (machine_id, status) values
  ('follow_request', 'pending'),
  ('follow_request', 'accepted'),
  ('follow_request', 'rejected'),
  ('follow_request', 'cancelled');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('follow_request', 'pending', 'accepted', ''),
  ('follow_request', 'pending', 'rejected', ''),
  ('follow_request', 'pending', 'cancelled', '');

-- ── 2. Reports: the 0005 trigger function asks the kernel ──────────────────────
create or replace function public.reports_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('report', old.status, new.status, null);
  exception
    when sqlstate 'P0001' then
      -- The 0005 codes, kept for existing callers: a resolved report cannot move, and an open
      -- report resolves only to one of the two outcomes.
      if sqlerrm in ('illegal_transition', 'unknown_state') and old.status <> 'open' then
        raise exception 'invalid_report_status_transition'
          using errcode = 'check_violation', detail = 'from=' || old.status || ' to=' || new.status;
      end if;
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'invalid_report_status_target'
          using errcode = 'check_violation', detail = 'status=' || coalesce(new.status, 'null');
      end if;
      raise;
  end;

  new.resolved_at := now();
  if new.resolved_by is null then
    new.resolved_by := auth.uid();
  end if;

  return new;
end;
$$;

comment on function public.reports_on_status_change() is
  'FSM wave 4a (0701): reports.status moves follow machine `report`; stamps resolved_at / resolved_by. Raises invalid_report_status_transition | invalid_report_status_target (23514).';

-- ── 3. Follow requests: every writer follows the graph ─────────────────────────
create or replace function kc_private.follow_requests_enforce_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same status: not a transition.
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('follow_request', old.status, new.status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'follow_request_transition_invalid'
          using errcode = '23514',
                detail = format('invalid follow request transition from %s to %s', old.status, new.status);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.follow_requests_enforce_fsm() is
  'FSM wave 4a (0701): follow_requests.status moves follow machine `follow_request` in fsm_edge; raises follow_request_transition_invalid (23514) otherwise.';

revoke all on function kc_private.follow_requests_enforce_fsm() from public, anon, authenticated;

drop trigger if exists follow_requests_status_fsm on public.follow_requests;
create trigger follow_requests_status_fsm
  before update of status on public.follow_requests
  for each row execute function kc_private.follow_requests_enforce_fsm();
