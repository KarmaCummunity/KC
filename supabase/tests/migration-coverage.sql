-- supabase/tests/migration-coverage.sql
-- Run after `supabase db reset` or after CI applies migrations to a fresh DB.
--
-- Purpose: catch the failure mode where a migration redefines a CHECK
-- constraint and silently drops a value that already exists in prod. The
-- 0034 push surfaced this exact bug (`delete_account` was dropped from the
-- audit_events.action set). This test asserts every historical value of
-- enum-like CHECK columns is still accepted by the live constraint.
--
-- To extend: when a new value is legitimately added to a CHECK, add it to
-- the appropriate array below.

create or replace function pg_temp.assert_check_accepts(p_table regclass, p_value text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = p_table
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%' || quote_literal(p_value) || '%'
  ) then
    raise exception 'CHECK regression: % no longer accepts %', p_table, p_value;
  end if;
end $$;

do $$
declare
  v text;
  v_audit_actions   text[] := array[
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account'
  ];
  v_report_statuses text[] := array[
    'open','confirmed_violation','dismissed_no_violation'
  ];
  v_post_statuses   text[] := array[
    'open','closed_delivered','deleted_no_recipient','expired','removed_admin','hidden_pending_review'
  ];
  v_account_statuses text[] := array[
    'pending_verification','active','suspended_for_false_reports',
    'suspended_admin','banned','deleted'
  ];
begin
  foreach v in array v_audit_actions loop
    perform pg_temp.assert_check_accepts('public.audit_events', v);
  end loop;

  foreach v in array v_report_statuses loop
    perform pg_temp.assert_check_accepts('public.reports', v);
  end loop;

  foreach v in array v_post_statuses loop
    perform pg_temp.assert_check_accepts('public.posts', v);
  end loop;

  foreach v in array v_account_statuses loop
    perform pg_temp.assert_check_accepts('public.users', v);
  end loop;
end $$;

\echo '✓ migration-coverage.sql passed — no CHECK regressions detected'
