-- supabase/tests/0523_time_world_active.sql | 0523 (FR-FEED-020, D60): the time world is
-- active, housing stays a portal until TD-245, and the other launch flags are untouched.

begin;

do $$
begin
  perform kc_test.assert_true(
    (select enabled from public.app_flags where key = 'world_time_enabled'),
    'the time world is active');
  perform kc_test.assert_true(
    not (select enabled from public.app_flags where key = 'world_housing_enabled'),
    'housing stays a portal until the create form pre-checks verification (TD-245)');
  perform kc_test.assert_eq(
    (select array_agg(key order by key) from public.app_flags where key like 'world\_%\_enabled' and enabled),
    array['world_food_enabled', 'world_items_enabled', 'world_rides_enabled', 'world_time_enabled']::text[],
    'exactly items, food, rides and time are active worlds');
end $$;

rollback;

\echo '✓ supabase/tests/0523_time_world_active.sql passed'
