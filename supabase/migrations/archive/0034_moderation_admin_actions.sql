-- 0034_moderation_admin_actions | P1.3 + P2.2 — schema scaffold
-- FR-MOD-007, FR-MOD-010, FR-ADMIN-002..005, FR-ADMIN-007.
--
-- Adds:
--   - reports.sanction_consumed_at column + supporting partial index
--   - audit_events action enum additions ('ban_user','delete_message')
--
-- Subsequent migrations in this slice (separate files for re-apply safety):
--   0035 — admin_restore_target RPC
--   0036 — admin_dismiss_report + admin_confirm_report RPCs
--   0037 — admin_ban_user + admin_delete_message RPCs
--   0038 — admin_audit_lookup + auth_check_account_gate RPCs
--   0039 — statement-level sanction trigger
--   0040 — owner-notification side-effect + find_or_create_support_chat hardening

-- ── 1. Schema additions ────────────────────────────────────────────────────

alter table public.reports
  add column if not exists sanction_consumed_at timestamptz;

create index if not exists reports_reporter_window_idx
  on public.reports (reporter_id, resolved_at)
  where status = 'dismissed_no_violation' and sanction_consumed_at is null;

-- Replace the audit_events action CHECK using NOT VALID + VALIDATE pattern to
-- avoid an ACCESS EXCLUSIVE table scan during application of the new check.
-- Order: add new (no scan) → validate (shares lock) → drop old (brief excl) →
-- rename (atomic, brief excl). Total time at heavy lock is minimal.
alter table public.audit_events
  add constraint audit_events_action_check_v2 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account'
  )) not valid;

alter table public.audit_events
  validate constraint audit_events_action_check_v2;

alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  rename constraint audit_events_action_check_v2 to audit_events_action_check;
