-- Report SLA alert (FR-ADMIN-012 AC6): an open case waiting past the warning time alerts each
-- moderation staff member once; a fresh, resolved or already-alerted case does not; members
-- and support staff are never alerted; the sweep is a registered hourly job.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local kc.rate_limit_exempt = 'on';

-- Queued report_sla_warning events, as "recipient digit:target type", sorted.
create function pg_temp.alerts()
returns text
language sql
as $$
  select coalesce(string_agg(right(e.payload ->> 'recipient_id', 1) || ':' || (e.payload -> 'entity' ->> 'type'), ','
                             order by e.payload ->> 'recipient_id', e.payload -> 'entity' ->> 'type'), 'none')
    from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = 'report_sla_warning';
$$;

select plan(8);

-- a super admin · b moderator · c support · 1–3 members.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b,c,1,2,3', ',')) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin'),
  ('00000000-0000-4000-8000-00000000000b', 'moderator'),
  ('00000000-0000-4000-8000-00000000000c', 'support');

-- Member 1 reported 13 hours ago and member 2 an hour ago (user 3); member 2 reported a chat
-- an hour ago; an old report on user 2 was already resolved.
insert into public.reports (reporter_id, target_type, target_id, reason, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'user', '00000000-0000-4000-8000-000000000003', 'Spam', now() - interval '13 hours'),
  ('00000000-0000-4000-8000-000000000002', 'user', '00000000-0000-4000-8000-000000000003', 'Spam', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000002', 'chat', '70000000-0000-4000-8000-000000000001', 'Spam', now() - interval '1 hour');
insert into public.reports (reporter_id, target_type, target_id, reason, status, resolved_at, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'user', '00000000-0000-4000-8000-000000000002', 'Spam',
   'dismissed_no_violation', now() - interval '20 hours', now() - interval '30 hours');

select is(kc_private.report_sla_alert_sweep(), 2, 'the sweep alerts about the overdue case only');
select is(pg_temp.alerts(), 'a:user,b:user',
  'the super admin and the moderator are alerted; support staff and members are not');
select is((select (e.payload -> 'entity' ->> 'id') from kc_private.outbox_events e
            where e.payload ->> 'kind' = 'report_sla_warning' limit 1),
  '00000000-0000-4000-8000-000000000003', 'the alert names the reported target, so it opens the case');

-- Delivery records the key; the next hourly run is quiet.
select is((select count(*) from kc_private.notifications_deliver_batch(50) r where r ->> 'status' <> 'failed'), 2::bigint,
  'the alerts are delivered');
select is(kc_private.report_sla_alert_sweep(), 0, 'a case is alerted once');

-- The chat case grows old: it alerts now, once.
update public.reports set created_at = now() - interval '12 hours' where target_type = 'chat';
select is(kc_private.report_sla_alert_sweep(), 2, 'a case that reaches the warning time alerts');

select is((select count(*) from kc_private.scheduled_jobs j
            where j.name = 'report_sla_alert' and j.command = 'select kc_private.report_sla_alert_sweep()'),
  1::bigint, 'the sweep is registered as an hourly job');
select is((select count(*) from kc_private.notification_kinds where kind = 'report_sla_warning'), 1::bigint,
  'report_sla_warning is a registered kind');

select * from finish();
rollback;
