-- supabase/tests/0676_demo_seed_rides_on_posts.sql | #1964: demo rides are feed posts, wiped with seed users.

begin;

do $$
declare
  v_rides int;
begin
  perform kc_test.assert_true(
    exists (
      select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'kc_dev_seed_demo_rides'
    ),
    'kc_dev_seed_demo_rides exists');
end $$;

create temp table personas as
select kc_test.create_user('ride_wipe_super') as super_admin,
       kc_test.create_user('ride_wipe_real') as real_user;

do $$
declare
  p personas%rowtype;
  r jsonb;
  v_rides int;
  v_real int;
begin
  select * into p from personas;

  delete from public.admin_role_grants where role = 'super_admin';
  insert into public.admin_role_grants (user_id, role) values (p.super_admin, 'super_admin');

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise notice '0676: no kc_dev_demo_config — skipping live seed/wipe ride assertions';
    return;
  end if;

  perform kc_test.act_as(p.super_admin);
  r := public.admin_seed_demo_data('SeedPass-2026');

  select count(*)::int into v_rides
    from public.posts po
    join auth.users a on a.id = po.owner_id
   where po.world_slug = 'rides'
     and a.email like '%@seed.kc.test';

  perform kc_test.assert_true(v_rides >= 80, 'seed creates ride posts visible in the rides world');
  perform kc_test.assert_true((r->>'rides')::int >= 80, 'seed result counts ride posts');

  insert into public.posts (owner_id, type, status, visibility, title, category, city, street, street_number,
    location_display_level, world_slug, direction, post_type, moderation_status, source_language)
  values (
    p.real_user, 'Give', 'open', 'Public', 'Real user control ride', 'Other', '5000', 'Herzl', '1',
    'CityOnly', 'rides', 'offer', 'ride', 'published', 'he'
  );

  perform public.admin_wipe_demo_data();

  select count(*)::int into v_rides
    from public.posts po
    join auth.users a on a.id = po.owner_id
   where po.world_slug = 'rides'
     and a.email like '%@seed.kc.test';
  perform kc_test.assert_eq(v_rides, 0, 'wipe removes all seed ride posts');

  select count(*)::int into v_real
    from public.posts where owner_id = p.real_user and title = 'Real user control ride';
  perform kc_test.assert_eq(v_real, 1, 'wipe leaves non-seed ride posts untouched');

  r := public.admin_seed_demo_data(null);
  select count(*)::int into v_rides
    from public.posts po
    join auth.users a on a.id = po.owner_id
   where po.world_slug = 'rides'
     and a.email like '%@seed.kc.test';
  perform kc_test.assert_true(v_rides >= 80, 'restore recreates ride posts');
end $$;

rollback;

\echo '✓ 0676_demo_seed_rides_on_posts.sql passed'
