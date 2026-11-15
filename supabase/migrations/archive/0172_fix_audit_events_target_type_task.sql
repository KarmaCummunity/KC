-- 0172_fix_audit_events_target_type_task — fix admin_task_* RPCs that hit
-- target_type constraint violation when writing audit rows.
--
-- Migration 0144 widened audit_events.action to include admin_task_create /
-- admin_task_update / admin_task_delete, but forgot to widen
-- audit_events.target_type to include 'task'. As a result every successful
-- admin_task_create call raised:
--
--   ERROR: new row for relation "audit_events" violates check constraint
--   "audit_events_target_type_check"
--
-- and the surrounding transaction was rolled back, leaving zero admin tasks
-- creatable since 0144 landed on dev. This migration closes that gap with the
-- same drop / add-not-valid / validate / rename dance pattern used elsewhere
-- in the audit_events constraint history (0034 / 0075 / 0143 / 0144).
--
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md §13 FR-ADMIN-018.

alter table public.audit_events
  drop constraint if exists audit_events_target_type_check;

alter table public.audit_events
  add constraint audit_events_target_type_check_v2 check (
    target_type in ('post', 'user', 'chat', 'report', 'task', 'none')
  ) not valid;

alter table public.audit_events validate constraint audit_events_target_type_check_v2;

alter table public.audit_events
  rename constraint audit_events_target_type_check_v2 to audit_events_target_type_check;
