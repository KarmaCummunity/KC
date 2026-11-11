-- 0611_report_sla_alert — FR-ADMIN-012 AC6: report_sla_alert_sweep alerts each active
-- super_admin / moderator once per open case that has waited 12 h, and nobody else.
-- The sweep is global, so every assertion is scoped to this test's own personas and targets.

begin;

create temp table personas as
select kc_test.create_user('sla_super') as super_admin,
       kc_test.create_user('sla_mod') as moderator,
       kc_test.create_user('sla_revoked') as revoked_mod,
       kc_test.create_user('sla_member') as member,
       kc_test.create_user('sla_reporter') as reporter,
       kc_test.create_user('sla_target_old') as target_old,
       kc_test.create_user('sla_target_fresh') as target_fresh,
       kc_test.create_user('sla_target_resolved') as target_resolved;

-- Only one super_admin may be active; the test's own grants are rolled back with the rest.
update public.admin_role_grants set revoked_at = now() where role = 'super_admin' and revoked_at is null;
insert into public.admin_role_grants (user_id, role, revoked_at)
select super_admin, 'super_admin', null::timestamptz from personas
union all select moderator, 'moderator', null::timestamptz from personas
union all select revoked_mod, 'moderator', now() from personas;

-- One case waiting 13 h, one filed an hour ago, one resolved after 14 h.
insert into public.reports (reporter_id, target_type, target_id, reason, status, created_at, resolved_at)
select reporter, 'user', target_old, 'Spam', 'open', now() - interval '13 hours', null::timestamptz from personas
union all
select reporter, 'user', target_fresh, 'Spam', 'open', now() - interval '1 hour', null::timestamptz from personas
union all
select reporter, 'user', target_resolved, 'Spam', 'dismissed_no_violation', now() - interval '14 hours', now() from personas;

create function pg_temp.sla_alerts(p_users uuid[], p_target uuid)
returns int language sql as $$
  select count(*)::int from public.notifications_outbox
   where kind = 'report_sla_warning'
     and user_id = any (p_users)
     and data->>'route' like '%' || p_target::text
$$;

do $$
declare
  p record;
begin
  select * into p from personas;
  perform public.report_sla_alert_sweep();

  perform kc_test.assert_eq(pg_temp.sla_alerts(array[p.super_admin, p.moderator], p.target_old), 2,
    'each active admin is alerted once about the case waiting 13 h');
  perform kc_test.assert_eq(
    pg_temp.sla_alerts(array[p.member, p.revoked_mod, p.reporter], p.target_old), 0,
    'members, revoked grants and the reporter are not alerted');
  perform kc_test.assert_eq(
    pg_temp.sla_alerts(array[p.super_admin, p.moderator], p.target_fresh), 0,
    'a case under 12 h does not alert');
  perform kc_test.assert_eq(
    pg_temp.sla_alerts(array[p.super_admin, p.moderator], p.target_resolved), 0,
    'a resolved case does not alert');

  perform public.report_sla_alert_sweep();
  perform kc_test.assert_eq(pg_temp.sla_alerts(array[p.super_admin, p.moderator], p.target_old), 2,
    'a second sweep does not alert again for the same case');
end $$;

rollback;
\echo '✓ 0611_report_sla_alert passed'
