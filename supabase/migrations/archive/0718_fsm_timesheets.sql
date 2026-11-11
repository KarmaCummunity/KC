-- 0718_fsm_timesheets | Wave 5 of the FSM kernel program (#1989, G61)
--
-- `timesheet_entries.status` (admin timesheets, V2-ADMIN-TIME-10, 0171) moves onto the kernel.
-- Each timesheet RPC checked the source status on its own; the graph now holds for every writer.
--
-- 1. Machine `timesheet`, equal to `timesheetMachine` in @kc/domain: the author submits a draft,
--    an approver decides a submitted entry once, and editing a rejected entry sends it back to
--    draft. An approval is final.
-- 2. Trigger `timesheet_entries_status_fsm` on the generic status body (0717). Who may make each
--    move stays in the RPCs (author, or the super admin / moderator approver roles).
--
-- The volunteer opportunity and shift signup lifecycles (0370) are not put on the kernel: no
-- client has created an opportunity since the time world moved to posts and events (G1 step 5b),
-- so they are tracked for retirement instead (`docs/architecture/state-machines.md` §3.3).

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('timesheet', 'draft'),
  ('timesheet', 'submitted'),
  ('timesheet', 'approved'),
  ('timesheet', 'rejected');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('timesheet', 'draft', 'submitted', ''),
  ('timesheet', 'submitted', 'approved', ''),
  ('timesheet', 'submitted', 'rejected', ''),
  ('timesheet', 'rejected', 'draft', '');

-- ── 2. The status trigger ──────────────────────────────────────────────────────
drop trigger if exists timesheet_entries_status_fsm on public.timesheet_entries;
create trigger timesheet_entries_status_fsm
  before update of status on public.timesheet_entries
  for each row execute function kc_private.enforce_status_fsm(
    'timesheet', 'status', 'timesheet_transition_invalid');
