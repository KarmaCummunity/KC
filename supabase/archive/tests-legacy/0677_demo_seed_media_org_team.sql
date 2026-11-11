-- supabase/tests/0677_demo_seed_media_org_team.sql | #1964 org team + item photo rows on seed.

begin;

do $$
declare
  p record;
  r jsonb;
  v_media int;
  v_members int;
begin
  select kc_test.create_user('demo_media_super') as super_admin into p;
  delete from public.admin_role_grants where role = 'super_admin';
  insert into public.admin_role_grants (user_id, role) values (p.super_admin, 'super_admin');

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise notice '0677: no kc_dev_demo_config — skipping live seed assertions';
    return;
  end if;

  perform kc_test.act_as(p.super_admin);
  perform public.admin_wipe_demo_data();
  r := public.admin_seed_demo_data('SeedPass-2026');

  select count(*)::int into v_media
    from public.media_assets m
    join public.posts po on po.post_id = m.post_id
    join auth.users a on a.id = po.owner_id
   where m.path like 'demo/kc-dev/items/%'
     and a.email like '%@seed.kc.test';

  perform kc_test.assert_true(v_media >= 50, 'seed attaches demo photo rows to item gives');

  select count(*)::int into v_members
    from public.org_memberships m
    join public.organizations o on o.org_id = m.org_id
   where o.verification_method = 'demo_seed';

  perform kc_test.assert_true(v_members >= 12, 'each demo org has staff across roles');

  perform public.admin_wipe_demo_data();
  select count(*)::int into v_media
    from public.media_assets m
    join public.posts po on po.post_id = m.post_id
    join auth.users a on a.id = po.owner_id
   where a.email like '%@seed.kc.test';
  perform kc_test.assert_eq(v_media, 0, 'wipe removes seed media rows with posts');

  select count(*)::int into v_members
    from public.org_memberships m
    join public.users u on u.user_id = m.user_id
    join auth.users a on a.id = u.user_id
   where a.email like '%@seed.kc.test'
     and exists (
       select 1 from public.organizations o
        where o.org_id = m.org_id and o.verification_method = 'demo_seed'
     );
  perform kc_test.assert_eq(v_members, 0, 'wipe removes seed org memberships');
end $$;

rollback;

\echo '✓ 0677_demo_seed_media_org_team.sql passed'
