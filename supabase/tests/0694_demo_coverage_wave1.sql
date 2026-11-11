-- supabase/tests/0694_demo_coverage_wave1.sql | DCC wave 1 fixtures + admin_demo_coverage_report.
-- Rolled back at the end.

begin;

create temp table personas as
select kc_test.create_user('dcc_super') as super_admin,
       kc_test.create_user('dcc_plain') as plain_user;

delete from public.admin_role_grants where role = 'super_admin';
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas;

insert into public.kc_dev_demo_config (password_hash)
values (extensions.crypt('SeedPass-2026', extensions.gen_salt('bf')))
on conflict (singleton) do update set password_hash = excluded.password_hash;

do $$
declare
  p personas;
  v_hash text;
  snap jsonb;
begin
  select * into p from personas;
  select password_hash into v_hash from public.kc_dev_demo_config where singleton;

  perform public.kc_dev_seed_demo_coverage_wave1(v_hash);

  snap := public.kc_dev_demo_coverage_snapshot();
  perform kc_test.assert_true((snap->>'complete')::boolean, 'wave 1 coverage is complete after seed');
  perform kc_test.assert_eq(jsonb_array_length(snap->'gaps'), 0, 'no coverage gaps');
  perform kc_test.assert_eq((snap#>>'{machines,post,covered}')::int, 7, 'all post S1 states covered');
  perform kc_test.assert_eq((snap#>>'{machines,admin_task,covered}')::int, 5, 'all admin_task states covered');

  perform kc_test.act_as(p.super_admin);
  perform kc_test.assert_true(
    (public.admin_demo_coverage_report()->>'complete')::boolean,
    'admin_demo_coverage_report matches internal snapshot');

  perform kc_test.act_as(p.plain_user);
  perform kc_test.assert_raises(
    'select public.admin_demo_coverage_report()',
    'forbidden',
    'non-admin cannot read coverage report');
end $$;

rollback;

\echo '✓ 0694_demo_coverage_wave1.sql passed'
