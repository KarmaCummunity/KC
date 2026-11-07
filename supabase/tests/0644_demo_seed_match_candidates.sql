-- supabase/tests/0644_demo_seed_match_candidates.sql | demo seed creates match_candidates and
-- user1@seed.kc.test sees open rows via rpc_my_matches.

begin;

create temp table personas as
select kc_test.create_user('seed_super') as super_admin;

delete from public.admin_role_grants where role = 'super_admin';
insert into public.admin_role_grants (user_id, role)
select super_admin, 'super_admin' from personas;

insert into public.kc_dev_demo_config (password_hash) values (null)
on conflict (singleton) do update set password_hash = excluded.password_hash;

do $$
declare
  p personas;
  r jsonb;
  u1 uuid;
  n int;
begin
  select * into p from personas;
  perform kc_test.act_as(p.super_admin);
  r := public.admin_seed_demo_data('SeedPass-2026');

  perform kc_test.assert_true((r->>'match_candidates')::int > 50,
    'demo seed reports a large match_candidates count');

  select id into u1 from auth.users where email = 'user1@seed.kc.test';
  perform kc_test.assert_true(u1 is not null, 'user1 exists');

  perform kc_test.act_as(u1);
  -- The seed leaves request.jwt.claim.sub on its actor for the audit row; auth.uid() prefers it.
  perform set_config('request.jwt.claim.sub', u1::text, true);
  select count(*)::int into n from public.rpc_my_matches(30);
  perform kc_test.assert_true(n >= 3,
    'user1 sees at least three open matches for the hub / feed UI');

  perform kc_test.act_as(p.super_admin);
  perform set_config('request.jwt.claim.sub', p.super_admin::text, true);
  perform public.admin_wipe_demo_data();
end $$;

rollback;

\echo '✓ 0644_demo_seed_match_candidates.sql passed'
