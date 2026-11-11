-- supabase/tests/0732_demo_seed_org_events.sql | kc-dev demo seed: organization events (G18).
-- The seeding admin manages every demo organization, and each organization has two upcoming
-- events with seed registrations. Runs only where kc_dev_demo_config exists (kc-dev), like 0677.

begin;

do $$
declare
  p record;
  v_orgs int;
  v_events int;
  v_registrations int;
begin
  select kc_test.create_user('demo_events_super') as super_admin into p;
  delete from public.admin_role_grants where role = 'super_admin';
  insert into public.admin_role_grants (user_id, role) values (p.super_admin, 'super_admin');

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise notice '0732: no kc_dev_demo_config — skipping live seed assertions';
    return;
  end if;

  perform kc_test.act_as(p.super_admin);
  perform public.admin_wipe_demo_data();
  perform public.admin_seed_demo_data('SeedPass-2026');

  select count(*)::int into v_orgs
    from public.org_memberships m
    join public.organizations o on o.org_id = m.org_id
   where o.verification_method = 'demo_seed' and m.user_id = p.super_admin and m.role = 'org_admin';
  perform kc_test.assert_eq(v_orgs, 3, 'the seeding admin manages each demo organization');

  select count(*)::int into v_events
    from public.event_post_details e
    join public.organizations o on o.org_id = e.org_id
   where o.verification_method = 'demo_seed' and e.starts_at > now();
  perform kc_test.assert_eq(v_events, 6, 'two upcoming events per demo organization');

  select count(*)::int into v_registrations
    from public.post_handoffs h
    join public.event_post_details e on e.post_id = h.post_id
    join public.organizations o on o.org_id = e.org_id
   where o.verification_method = 'demo_seed' and h.status in ('confirmed', 'reserved', 'waitlisted');
  perform kc_test.assert_true(v_registrations >= 12, 'seed members registered to the demo events');

  perform public.admin_wipe_demo_data();
  perform kc_test.assert_eq(
    (select count(*)::int from public.organizations where verification_method = 'demo_seed'), 0,
    'the wipe removes the demo organizations, their events and memberships');
end $$;

rollback;

\echo '✓ 0732_demo_seed_org_events.sql passed'
