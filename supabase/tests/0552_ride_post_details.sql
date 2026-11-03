-- supabase/tests/0552_ride_post_details.sql | 0552 (G1 step 1, ADR-006): a ride post has a
-- ride_post_details row that copies the listing's ride details (route ends, schedule, seats,
-- passengers), follows every listing edit, disappears with the post, and is readable only
-- through the post's visibility.

begin;

create temp table personas as
select kc_test.create_user('ride_details_driver')    as driver,
       kc_test.create_user('ride_details_passenger') as passenger;

create function pg_temp.details_of(p_listing uuid)
returns public.ride_post_details
language plpgsql
as $$
declare
  v public.ride_post_details;
begin
  select r.* into v
    from public.ride_post_details r
    join public.posts p on p.post_id = r.post_id
   where p.listing_id = p_listing;
  if not found then
    perform kc_test.fail('ride listing has no ride_post_details row');
  end if;
  return v;
end $$;

-- ── A ride offer: route ends, departure, seats ──────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  l public.listings;
  d public.ride_post_details;
begin
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.driver, 3, interval '3 hours');
  select * into l from public.listings where listing_id = v_listing;
  d := pg_temp.details_of(v_listing);

  perform kc_test.assert_eq(d.departs_at, (l.details ->> 'departs_at')::timestamptz, 'departure is copied');
  perform kc_test.assert_eq(d.origin_place_kind, 'city', 'origin place kind is copied');
  perform kc_test.assert_eq(d.origin_place_id, l.details ->> 'origin_place_id', 'origin place is copied');
  perform kc_test.assert_eq(d.dest_place_id, l.details ->> 'dest_place_id', 'destination place is copied');
  perform kc_test.assert_eq(d.seats_available, 3, 'seats are copied');
  perform kc_test.assert_true(d.passengers is null, 'an offer has no passenger count');
  perform kc_test.assert_eq(d.meeting_points, '[]'::jsonb, 'no meeting points means an empty list');
  perform kc_test.assert_true(d.series_id is null, 'a single ride has no series');

  -- An edit of the listing details reaches the extension.
  update public.listings
     set details = details || jsonb_build_object(
           'seats_available', 2,
           'arrives_at', kc_test.iso_in(interval '5 hours'),
           'cost_share_ils', 15)
   where listing_id = v_listing;
  d := pg_temp.details_of(v_listing);
  perform kc_test.assert_eq(d.seats_available, 2, 'fewer seats reach the extension');
  perform kc_test.assert_eq(d.arrives_at, kc_test.iso_in(interval '5 hours')::timestamptz, 'the estimated end reaches the extension');
  perform kc_test.assert_eq(d.cost_share_ils, 15::numeric, 'the cost share reaches the extension');

  -- The row goes with the post (and the post with the listing).
  delete from public.listings where listing_id = v_listing;
  perform kc_test.assert_row_count(
    format('select 1 from public.ride_post_details where post_id = %L', d.post_id), 0,
    'deleting the listing removes the ride details');
end $$;

-- ── A ride request: passengers, no seats ────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  d public.ride_post_details;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.passenger, 'rides', 'ride_request', 'request', 'Jerusalem to Tel Aviv',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object(
      'departs_at', kc_test.iso_in(interval '1 day'), 'passengers', 2, 'luggage', true));
  d := pg_temp.details_of(v_listing);
  perform kc_test.assert_eq(d.passengers, 2, 'passengers are copied');
  perform kc_test.assert_true(d.luggage, 'luggage is copied');
  perform kc_test.assert_true(d.seats_available is null, 'a request offers no seats');
  perform kc_test.assert_eq((select post_type from public.posts where post_id = d.post_id), 'ride',
    'the request post is a ride post');
end $$;

-- ── Access: read through the post, never written by clients ─────────────────────────
do $$
begin
  perform kc_test.assert_row_count(
    $q$select 1 from pg_policies where schemaname = 'public' and tablename = 'ride_post_details'$q$, 1,
    'exactly one policy on ride_post_details');
  perform kc_test.assert_eq(
    (select cmd::text from pg_policies where schemaname = 'public' and tablename = 'ride_post_details'),
    'SELECT', 'the only policy is a read policy');
  perform kc_test.assert_true(
    not has_table_privilege('authenticated', 'public.ride_post_details', 'insert')
    and not has_table_privilege('authenticated', 'public.ride_post_details', 'update')
    and not has_table_privilege('authenticated', 'public.ride_post_details', 'delete'),
    'authenticated cannot write ride_post_details');
  perform kc_test.assert_true(
    not has_table_privilege('anon', 'public.ride_post_details', 'select'),
    'anon cannot read ride_post_details');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.ride_post_details_upsert(uuid, jsonb)', 'execute'),
    'the upsert is not a client RPC');
end $$;

-- ── The report sees every ride described ───────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'ride_details_missing')::int, 0, 'every ride post has its details');
  perform kc_test.assert_eq((r ->> 'ride_field_mismatches')::int, 0, 'every ride extension agrees with its listing');
end $$;

rollback;
\echo '✓ 0552_ride_post_details.sql passed'
