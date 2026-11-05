-- 0611_report_sla_alert | FR-ADMIN-012 AC6 (#1039)
-- Store review expects a reported item to be acted on within 24 h. This sweep tells every active
-- super_admin / moderator when an open report case has waited 12 h, once per case, so there is
-- time left to act. Hourly via pg_cron; the inbox badge (ReportSla.ts) uses the same 12 h / 24 h.

begin;

create or replace function public.report_sla_alert_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_id    uuid;
  c       record;
  a       record;
begin
  -- A case is one open target; its age is the age of its oldest open report (as in the inbox).
  for c in
    select r.target_type,
           r.target_id,
           min(r.created_at) as oldest_at
      from public.reports r
     where r.status = 'open'
       and r.target_type in ('post', 'user', 'chat')
       and r.target_id is not null
     group by r.target_type, r.target_id
    having min(r.created_at) <= now() - interval '12 hours'
  loop
    for a in
      select distinct g.user_id
        from public.admin_role_grants g
       where g.revoked_at is null
         and g.role in ('super_admin', 'moderator')
    loop
      -- The dedupe key carries the case's oldest report, so a case reopened later alerts again.
      v_id := public.enqueue_notification(
        a.user_id,
        'critical',
        'report_sla_warning',
        'notifications.reportSlaTitle',
        'notifications.reportSlaBody',
        jsonb_build_object(
          'target_type', c.target_type,
          'hours', floor(extract(epoch from (now() - c.oldest_at)) / 3600)::int
        ),
        jsonb_build_object(
          'route', '/(admin)/reports/' || c.target_type || '%3A' || c.target_id::text
        ),
        'report_sla:' || c.target_type || ':' || c.target_id::text || ':'
          || a.user_id::text || ':' || extract(epoch from c.oldest_at)::bigint::text,
        true
      );
      if v_id is not null then v_count := v_count + 1; end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.report_sla_alert_sweep() from public;
grant execute on function public.report_sla_alert_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'report_sla_alert_hourly') then
      perform cron.unschedule('report_sla_alert_hourly');
    end if;
    perform cron.schedule(
      'report_sla_alert_hourly',
      '17 * * * *',
      $sql$ select public.report_sla_alert_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — report_sla_alert_hourly not scheduled.';
  end if;
end $$;

commit;
