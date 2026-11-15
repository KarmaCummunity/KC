-- supabase/tests/0678_demo_identity_content_matrix.sql | #1964 verification spread + visibility + fixtures hook.

begin;

do $$
declare
  p record;
  v_l0 int;
  v_l1 int;
  v_l2 int;
  v_only_me int;
begin
  select kc_test.create_user('demo_identity_super') as super_admin into p;
  delete from public.admin_role_grants where role = 'super_admin';
  insert into public.admin_role_grants (user_id, role) values (p.super_admin, 'super_admin');

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise notice '0678: no kc_dev_demo_config — skipping live seed assertions';
    return;
  end if;

  perform kc_test.act_as(p.super_admin);
  perform public.admin_wipe_demo_data();
  perform public.admin_seed_demo_data('SeedPass-2026');

  select count(*)::int into v_l0
    from public.users u
    join auth.users a on a.id = u.user_id
   where a.email like '%@seed.kc.test'
     and u.verification_level = 0;

  select count(*)::int into v_l1
    from public.users u
    join auth.users a on a.id = u.user_id
   where a.email like '%@seed.kc.test'
     and u.verification_level = 1;

  select count(*)::int into v_l2
    from public.users u
    join auth.users a on a.id = u.user_id
   where a.email like '%@seed.kc.test'
     and u.verification_level = 2;

  perform kc_test.assert_true(v_l0 >= 40, 'seed includes level-0 demo users');
  perform kc_test.assert_true(v_l1 >= 40, 'seed includes level-1 demo users');
  perform kc_test.assert_true(v_l2 >= 40, 'seed includes level-2 demo users');

  select count(*)::int into v_only_me
    from public.posts po
    join auth.users a on a.id = po.owner_id
   where a.email like '%@seed.kc.test'
     and po.visibility = 'OnlyMe';

  perform kc_test.assert_true(v_only_me >= 20, 'item posts include OnlyMe visibility slice');
end $$;

rollback;

\echo '✓ 0678_demo_identity_content_matrix.sql passed'
