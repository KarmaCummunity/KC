-- supabase/tests/0692_compat_views_caller_rights.sql
-- 0692: the G1 compatibility views (`listings`, `giving_handoffs`, `ride_listings`) follow the
-- access rules of the tables they read. Statements run under `set local role authenticated`,
-- because these rules are privileges and row-level security. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('compat_owner')    as owner,
       kc_test.create_user('compat_stranger') as stranger;

-- Runs p_sql as p_user under the client role; returns the error message, or null on success.
create function pg_temp.client_error(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  reset role;
  return v_error;
end;
$$;

-- Runs a count query as p_user under the client role.
create function pg_temp.client_count(p_user uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v_count;
  reset role;
  return v_count;
end;
$$;

-- Creates a ride request through the view as p_user (the app's create flow) and returns its id.
create function pg_temp.client_ride(p_user uuid)
returns uuid
language plpgsql
as $$
declare
  v_ride uuid;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.ride_listings (owner_id, mode, origin_city_id, dest_city_id, departs_at, title,
                                    origin_street, dest_street)
  values (p_user, 'request', '5000', '3000', now() + interval '2 days', 'Ride to Jerusalem',
          'Herzl', 'Jaffa')
  returning ride_id into v_ride;
  reset role;
  return v_ride;
end;
$$;

-- ── 1. Reads follow the posts visibility rules ─────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_sql text;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.owner, 'time', 'volunteer_shift', 'give', 'Private shift',
    '{"duration_minutes": 60}'::jsonb);
  update public.posts set visibility = 'OnlyMe' where post_id = v_listing;
  v_sql := format('select count(*) from public.listings where listing_id = %L', v_listing);

  perform kc_test.assert_eq(pg_temp.client_count(p.owner, v_sql), 1::bigint,
    'the owner reads an OnlyMe listing');
  perform kc_test.assert_eq(pg_temp.client_count(p.stranger, v_sql), 0::bigint,
    'another member does not see an OnlyMe listing');
end $$;

-- ── 2. listings and giving_handoffs are written by server functions only ───────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.assert_true(
    pg_temp.client_error(p.owner, 'update public.listings set title = title') like '%permission denied%',
    'a client does not write listings directly');
  perform kc_test.assert_true(
    pg_temp.client_error(p.owner, 'select count(*) from public.giving_handoffs') like '%permission denied%',
    'a client reads handoffs through post_handoffs, not the compatibility view');
  perform kc_test.assert_true(
    pg_temp.client_error(p.owner, 'update public.giving_handoffs set status = status') like '%permission denied%',
    'a client does not write giving_handoffs directly');
end $$;

-- ── 3. ride_listings: the owner creates and closes; nobody else writes ─────────
do $$
declare
  p personas;
  v_ride uuid;
begin
  select * into p from personas;

  perform kc_test.assert_true(
    pg_temp.client_error(p.stranger, format(
      'insert into public.ride_listings (owner_id, mode, origin_city_id, dest_city_id, departs_at, title, '
      'origin_street, dest_street) values (%L, ''request'', ''5000'', ''3000'', now() + interval ''1 day'', '
      '''x'', ''A'', ''B'')', p.owner)) like '%ride_listing_owner_required%',
    'a ride is created for the caller only');

  v_ride := pg_temp.client_ride(p.owner);
  perform kc_test.assert_eq((select status from public.posts where post_id = v_ride), 'open',
    'the owner creates a ride through the view');

  perform kc_test.assert_true(
    pg_temp.client_error(p.stranger, format(
      'update public.ride_listings set status = ''closed'' where ride_id = %L', v_ride))
      like '%ride_listing_owner_required%',
    'only the owner closes a ride');
  perform kc_test.assert_true(
    pg_temp.client_error(p.owner, format(
      'update public.ride_listings set status = ''removed_admin'' where ride_id = %L', v_ride))
      like '%ride_listing_status_not_allowed%',
    'moderation statuses are not set from the app');
  perform kc_test.assert_true(
    pg_temp.client_error(p.owner, format('delete from public.ride_listings where ride_id = %L', v_ride))
      like '%permission denied%',
    'a ride is not deleted through the view');

  perform kc_test.assert_eq(
    pg_temp.client_error(p.owner, format(
      'update public.ride_listings set status = ''closed'' where ride_id = %L', v_ride)),
    null::text, 'the owner closes the ride');
  perform kc_test.assert_eq((select status from public.posts where post_id = v_ride), 'closed_delivered',
    'closing reaches the post');
end $$;

rollback;

\echo '✓ 0692_compat_views_caller_rights.sql passed'
