-- 0076_suspension_expiry_cron | TD-57
-- Cron-based suspension expiry for false-report sanctions.
--
-- Problem: auth_check_account_gate (0038) lifts suspended_for_false_reports
-- lazily on next sign-in. A user whose suspension expired but who never signs
-- in again stays locked out indefinitely.
--
-- Fix: daily function that scans for expired suspensions and lifts them,
-- writing an audit event so the resolution is traceable.
--
-- Requires pg_cron enabled (same operator note as 0016 and 0045).

-- ── 1. Expiry function ────────────────────────────────────────────────────────
create or replace function public.suspension_expiry_lift()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   record;
  v_lifted integer := 0;
begin
  for v_user in
    select user_id
      from public.users
     where account_status = 'suspended_for_false_reports'
       and account_status_until is not null
       and account_status_until <= now()
  loop
    update public.users
       set account_status       = 'active',
           account_status_until = null
     where user_id = v_user.user_id;

    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (
      null,
      'unsuspend_user',
      'user',
      v_user.user_id,
      jsonb_build_object('cron', true, 'reason', 'suspension_period_expired')
    );

    v_lifted := v_lifted + 1;
  end loop;

  return v_lifted;
end $$;

-- Not callable by authenticated/anon clients — cron and SQL-editor only.
revoke execute on function public.suspension_expiry_lift() from public, authenticated, anon;

-- ── 2. Daily cron ────────────────────────────────────────────────────────────
-- Daily at 03:00 UTC — offset from the 04:00 closure cron to spread load.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'suspension_expiry_daily') then
      perform cron.unschedule('suspension_expiry_daily');
    end if;
    perform cron.schedule(
      'suspension_expiry_daily',
      '0 3 * * *',
      $sql$ select public.suspension_expiry_lift(); $sql$
    );
  else
    raise notice
      'pg_cron not enabled — suspension_expiry_daily not scheduled. Enable pg_cron in Supabase dashboard, then re-run.';
  end if;
end $$;

-- end of 0076_suspension_expiry_cron
