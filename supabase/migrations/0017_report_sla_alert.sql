-- Moderation · the report SLA alert (FR-ADMIN-012 AC5, AC6; #1039)
--
-- Store review expects a reported item to be acted on within 24 hours. Every hour a sweep
-- tells each moderator, admin and super admin about every open report case whose oldest open
-- report has waited the warning time (12 hours), once per case: the dedupe key carries the
-- case's oldest open report, so a case resolved and reported again later alerts again. A
-- resolved case never alerts. The inbox badge (`reportSlaState` in @kc/domain) uses the
-- same 12 / 24 hours.

alter table kc_private.moderation_settings
  add column report_sla_warning_after interval not null default interval '12 hours'
    check (report_sla_warning_after > interval '0');
comment on column kc_private.moderation_settings.report_sla_warning_after is
  'How long the oldest open report of a case may wait before staff are alerted (FR-ADMIN-012 AC6).';

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  ('report_sla_warning', 'critical', 'notifications.reportSlaWarningTitle', 'notifications.reportSlaWarningBody');

-- Enqueues one `report_sla_warning` per overdue case and moderation staff member who has not
-- been alerted about it yet; the notification opens the case (entity = the reported target).
-- Returns the number of notifications enqueued. Run hourly by the scheduler.
create function kc_private.report_sla_alert_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with overdue as (
    select r.target_type, r.target_id, min(r.created_at) as oldest_at
      from public.reports r
     where r.status = 'open'
     group by r.target_type, r.target_id
    having min(r.created_at) <= now() - (select s.report_sla_warning_after from kc_private.moderation_settings s)
  ),
  staff as (
    select distinct g.user_id
      from public.admin_role_grants g
      join kc_private.admin_roles r on r.role = g.role and r.is_platform
      join kc_private.admin_roles m on m.role = 'moderator'
      join public.users u on u.id = g.user_id and u.is_active
     where g.revoked_at is null and r.rank >= m.rank
  ),
  due as (
    select o.target_type, o.target_id, st.user_id,
           'report_sla:' || o.target_type || ':' || o.target_id || ':'
             || extract(epoch from o.oldest_at)::bigint as case_key
      from overdue o cross join staff st
  )
  select count(kc_private.outbox_enqueue('notification', jsonb_build_object(
           'kind', 'report_sla_warning', 'recipient_id', d.user_id, 'actor_id', null,
           'entity', jsonb_build_object('type', d.target_type, 'id', d.target_id),
           'data', jsonb_build_object('dedupe_key', d.case_key))))::integer
    into v_count
    from due d
   -- Already alerted (the delivery ledger holds the key): no second event every hour.
   where not exists (select 1 from kc_private.notification_dedupe x
                      where x.user_id = d.user_id and x.dedupe_key = d.case_key);
  return v_count;
end;
$$;
comment on function kc_private.report_sla_alert_sweep() is
  'Hourly: alerts moderation staff once per open report case waiting past the SLA warning time.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('report_sla_alert', '17 * * * *', 'select kc_private.report_sla_alert_sweep()',
   interval '2 minutes', interval '4 hours',
   'Report cases waiting past the SLA warning time: one alert per case to moderation staff.');
