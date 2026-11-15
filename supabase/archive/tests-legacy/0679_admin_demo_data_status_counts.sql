-- supabase/tests/0679_admin_demo_data_status_counts.sql | status exposes ride/org KPI fields.

begin;

do $$
declare
  p record;
  s jsonb;
begin
  select kc_test.create_user('demo_status_super') as super_admin into p;
  delete from public.admin_role_grants where role = 'super_admin';
  insert into public.admin_role_grants (user_id, role) values (p.super_admin, 'super_admin');

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise notice '0679: no kc_dev_demo_config — skipping live seed assertions';
    return;
  end if;

  perform kc_test.act_as(p.super_admin);
  perform public.admin_wipe_demo_data();
  perform public.admin_seed_demo_data('SeedPass-2026');

  s := public.admin_demo_data_status();
  perform kc_test.assert_true((s ? 'demo_ride_posts'), 'status includes demo_ride_posts');
  perform kc_test.assert_true((s->>'demo_ride_posts')::int >= 80, 'ride posts KPI matches seeded feed');
  perform kc_test.assert_true((s->>'demo_org_memberships')::int >= 12, 'org memberships KPI visible');
  perform kc_test.assert_true((s->>'demo_item_posts')::int >= 400, 'item posts KPI visible');
end $$;

rollback;

\echo '✓ 0679_admin_demo_data_status_counts.sql passed'
