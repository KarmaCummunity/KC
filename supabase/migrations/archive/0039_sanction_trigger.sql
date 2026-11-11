-- 0039_sanction_trigger | P1.3 / FR-MOD-010 — false-report sanction escalation
-- Statement-level AFTER UPDATE trigger on reports.status. For each distinct
-- reporter whose row(s) just transitioned to 'dismissed_no_violation', counts
-- their unconsumed dismissed reports in the last 30 days; if ≥ 5, applies the
-- next sanction level (7d → 30d → permanent), marks the consumed reports,
-- and writes audit events.
--
-- Statement-level + per-reporter advisory lock + level guard ensure that one
-- admin click that mass-stamps N reports for the same reporter increments the
-- sanction by AT MOST one level — preventing the "instant permanent ban from
-- one restore click" failure mode the council review surfaced.

create or replace function public.reports_after_status_change_apply_sanctions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count        int;
  v_existing     int;
  v_new_level    int;
  v_until        timestamptz;
  v_lock_key     bigint;
begin
  for r in
    select distinct reporter_id
      from new_rows
     where status = 'dismissed_no_violation'
  loop
    -- hashtext() returns int4; cast to int8 because pg_advisory_xact_lock
    -- expects bigint. Avoids depending on hashtextextended (PG 11+).
    v_lock_key := hashtext('mod_sanction_' || r.reporter_id::text)::bigint;
    perform pg_advisory_xact_lock(v_lock_key);

    select count(*) into v_count
      from public.reports
     where reporter_id = r.reporter_id
       and status = 'dismissed_no_violation'
       and resolved_at > now() - interval '30 days'
       and sanction_consumed_at is null;

    if v_count < 5 then
      continue;
    end if;

    select coalesce(false_report_sanction_count, 0) into v_existing
      from public.users where user_id = r.reporter_id for update;

    v_new_level := least(v_existing + 1, 3);
    v_until := case v_new_level
      when 1 then now() + interval '7 days'
      when 2 then now() + interval '30 days'
      else null  -- permanent
    end;

    update public.users
       set false_report_sanction_count = v_new_level,
           account_status              = 'suspended_for_false_reports',
           account_status_until        = v_until
     where user_id = r.reporter_id
       and false_report_sanction_count = v_existing;  -- level guard

    update public.reports
       set sanction_consumed_at = now()
     where reporter_id = r.reporter_id
       and status = 'dismissed_no_violation'
       and resolved_at > now() - interval '30 days'
       and sanction_consumed_at is null;

    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values
      (null, 'false_report_sanction_applied', 'user', r.reporter_id,
       jsonb_build_object('level', v_new_level, 'until', v_until)),
      (null, 'suspend_user', 'user', r.reporter_id,
       jsonb_build_object('reason', 'false_reports', 'level', v_new_level));
  end loop;

  return null;
end;
$$;

-- Transition tables (`referencing new table`) cannot coexist with a column
-- list (`of status`). The function filters by status internally, so dropping
-- the column list is safe — non-status updates produce an empty loop.
drop trigger if exists reports_after_status_change_sanctions on public.reports;
create trigger reports_after_status_change_sanctions
  after update on public.reports
  referencing new table as new_rows
  for each statement
  execute function public.reports_after_status_change_apply_sanctions();
