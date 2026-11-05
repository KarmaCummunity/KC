-- supabase/tests/0625_g1_listing_write_cap_on_posts.sql | 0625 (G1 step 6a-5a, issue #1671): the
-- hourly listing write cap counts the post a create RPC writes.
--   1. the create RPC of a listing world is capped on the post it writes, and nothing is written
--      past the cap;
--   2. a directly inserted listing and a post written by the create RPC share one hourly budget,
--      and the mirror post of the listing is not counted a second time;
--   3. items posts stay outside this cap.
-- Runs in a rolled-back transaction.

begin;

-- Lower the configurable cap for compact boundary checks; the rollback restores the seeded 20.
update public.marketplace_rule_params set param_value = '2'
 where rule_code = 'R-SEC-Listing-Write' and param_key = 'max_per_hour';

create temp table personas as
select kc_test.create_user('cap_driver')   as driver,
       kc_test.create_user('cap_mixed')    as mixed,
       kc_test.create_user('cap_giver')    as giver;

/** A ride offer published through the create RPC, as the app does (writes the post). */
create function pg_temp.create_ride(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => p_title,
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv');
end $$;
-- 0520: pg_temp helpers are called after act_as, so they need an explicit grant.
grant execute on function pg_temp.create_ride(uuid, text) to public;

/** The number of rides posts p_owner owns. */
create function pg_temp.ride_posts_of(p_owner uuid)
returns bigint
language sql
as $$ select count(*) from public.posts where owner_id = p_owner and world_slug = 'rides' $$;
grant execute on function pg_temp.ride_posts_of(uuid) to public;

-- ── T1 the create RPC is capped on the post it writes ─────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform pg_temp.create_ride(p.driver, 'first ride');
  perform pg_temp.create_ride(p.driver, 'second ride');
  perform kc_test.assert_raises(
    format('select pg_temp.create_ride(%L, %L)', p.driver, 'third ride'),
    'rate_limit_exceeded', 'the third publication in an hour is capped on the post');
  perform kc_test.assert_eq(pg_temp.ride_posts_of(p.driver), 2::bigint,
    'nothing is written past the cap');
end $$;

-- ── T2 a direct listing and a create-RPC post share one budget, each counted once ─────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  -- A listing-sourced ride: the listing insert counts; its mirror post does not.
  perform kc_test.create_ride_offer(p.mixed);
  perform kc_test.assert_eq(pg_temp.ride_posts_of(p.mixed), 1::bigint,
    'the direct listing has its mirror post');
  perform pg_temp.create_ride(p.mixed, 'post-owned ride');
  perform kc_test.assert_raises(
    format('select pg_temp.create_ride(%L, %L)', p.mixed, 'one too many'),
    'rate_limit_exceeded', 'the listing and the post drew on the same hourly budget');
end $$;

-- ── T3 items posts stay outside the listing write cap ─────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  select p.giver, 'Give', format('item %s', n), 'Other', 'tel-aviv', 'Herzl', '1'
    from generate_series(1, 3) as n;
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where owner_id = %L and world_slug = %L', p.giver, 'items'),
    3, 'three items posts in an hour are not capped by the listing write cap');
end $$;

rollback;
\echo '✓ 0625_g1_listing_write_cap_on_posts.sql passed'
