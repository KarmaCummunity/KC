-- supabase/tests/0648_demo_seed_all_giving_worlds.sql | demo seed fills every giving world.

begin;

do $$
begin
  perform kc_test.assert_true(
    exists (
      select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'kc_dev_seed_demo_world_content'
    ),
    'kc_dev_seed_demo_world_content exists');
end $$;

rollback;

\echo '✓ 0648_demo_seed_all_giving_worlds.sql passed'
