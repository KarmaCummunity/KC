-- supabase/tests/0520_function_execute_explicit_grants.sql
-- Regression for migration 0520 (#1063, ADR-002 §2): EXECUTE on functions is explicit.
--
--   1. A function created from now on is executable by its owner and service_role only.
--   2. No SECURITY DEFINER trigger function in `public` is executable by a client role.
--   3. The internal helpers are service_role only.
--   4. `anon` reaches SECURITY DEFINER functions only through the reviewed public-read list.
--   5. Every function an RLS policy evaluates for `authenticated` stays executable by it,
--      so the default-deny never breaks a policy.
-- Runs in a rolled-back transaction.

begin;

-- Fails with the offending names when p_sql (a query returning one text column) has rows.
create function pg_temp.assert_none(p_sql text, p_message text)
returns void
language plpgsql
as $$
declare
  v_offenders text;
begin
  execute format('select string_agg(x::text, '', '' order by x::text) from (%s) as q(x)', p_sql)
     into v_offenders;
  if v_offenders is not null then
    perform kc_test.fail(format('%s: %s', p_message, v_offenders));
  end if;
end;
$$;

-- True when PUBLIC (grantee 0) holds EXECUTE on the function, explicitly or by default.
create function pg_temp.public_can_execute(p_fn oid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
     where p.oid = p_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE');
$$;

-- ── 1. New functions are private by default ──────────────────────────────────
create function public.kc_test_new_function_probe() returns integer language sql as $$ select 1 $$;
create function kc_test.new_function_probe() returns integer language sql as $$ select 1 $$;

select kc_test.assert_true(
  not pg_temp.public_can_execute('public.kc_test_new_function_probe()'::regprocedure)
    and not pg_temp.public_can_execute('kc_test.new_function_probe()'::regprocedure),
  'a new function must not be executable by PUBLIC, in any schema');
select kc_test.assert_true(
  not has_function_privilege('anon', 'public.kc_test_new_function_probe()', 'EXECUTE'),
  'a new function in public must not be executable by anon');
select kc_test.assert_true(
  not has_function_privilege('authenticated', 'public.kc_test_new_function_probe()', 'EXECUTE'),
  'a new function in public must not be executable by authenticated until its migration grants it');
select kc_test.assert_true(
  has_function_privilege('service_role', 'public.kc_test_new_function_probe()', 'EXECUTE'),
  'a new function in public must stay executable by service_role');

-- ── 2. SECURITY DEFINER trigger functions ────────────────────────────────────
select pg_temp.assert_none($q$
  select p.oid::regprocedure
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and p.prorettype = 'trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
$q$, 'SECURITY DEFINER trigger functions executable by a client role');

-- ── 3. Internal helpers: service_role only ───────────────────────────────────
create temp table internal_helpers(fn regprocedure) on commit drop;
insert into internal_helpers values
  ('public.enqueue_notification(uuid, text, text, text, text, jsonb, jsonb, text, boolean)'),
  ('public.find_matches(uuid, integer, uuid)'),
  ('public.effective_geo(public.listings, uuid)'),
  ('public.validate_listing_details(uuid, jsonb)'),
  ('public.listing_upsert_from_post(public.posts)'),
  ('public.listing_upsert_from_ride(public.ride_listings)'),
  ('public.listing_feed_mirror_upsert(public.listings, boolean)'),
  ('public.listing_feed_hidden(public.listings)'),
  ('public.listing_feed_mirror_sync_media(uuid, uuid)'),
  ('public.food_expired_listings_sweep()'),
  ('public.giving_handoff_no_show_sweep()'),
  ('public.giving_handoff_row_of(uuid)'),
  ('public.karma_recompute_nightly()');

select pg_temp.assert_none($q$
  select fn from internal_helpers
   where has_function_privilege('anon', fn, 'EXECUTE')
      or has_function_privilege('authenticated', fn, 'EXECUTE')
$q$, 'internal helpers executable by a client role');
select pg_temp.assert_none($q$
  select fn from internal_helpers where not has_function_privilege('service_role', fn, 'EXECUTE')
$q$, 'internal helpers no longer executable by service_role');

-- ── 4. anon: the reviewed public-read surface only ───────────────────────────
-- Adding a SECURITY DEFINER function anon may call means adding it here, on purpose:
-- RLS predicates evaluated for guests, and public-read RPCs.
select pg_temp.assert_none($q$
  select p.proname
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname <> all (array[
       -- RLS / view predicates
       'is_blocked', 'is_chat_visible_to', 'is_listing_operator', 'is_listing_visible_to',
       'is_post_engagement_visible', 'is_post_visible_to', 'participant_closed_surface_visible',
       'shows_active_status',
       -- public-read RPCs
       'browse_listings', 'get_marketplace_listing_detail', 'get_nonprofit_public_page',
       'get_public_research_questions', 'get_volunteer_opportunity_detail',
       'list_kc_support_channels', -- FR-DONATE-011 AC9: masks payee_phone for anon
       'list_profile_listings',
       'list_ride_series_occurrences', 'list_rides_feed', 'list_verified_nonprofits', 'list_volunteer_opportunities',
       'map_listing_clusters', 'map_listing_pins', 'marketplace_search', 'profile_closed_posts',
       'profile_closed_posts_count', 'ride_listings_search', 'rpc_org_transparency', 'search_listings', 'search_posts_page',
       'search_users_page', 'similar_listings',
       'user_verification_level' -- FR-VERIFY-001: same 0..3 value as the public users.verification_level column
       ])
$q$, 'SECURITY DEFINER functions executable by anon outside the public-read list');

-- ── 5. RLS policies keep the functions they evaluate ─────────────────────────
select pg_temp.assert_none($q$
  select distinct format('%s (policy %s on %s)', d.refobjid::regprocedure, pol.polname,
                         pol.polrelid::regclass)
    from pg_policy pol
    join pg_depend d
      on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
     and d.refclassid = 'pg_proc'::regclass
   where (pol.polroles = '{0}' or 'authenticated'::regrole = any (pol.polroles))
     and not has_function_privilege('authenticated', d.refobjid, 'EXECUTE')
$q$, 'functions an RLS policy evaluates for authenticated but authenticated cannot execute');

rollback;

\echo '✓ 0520 function EXECUTE explicit-grant regression test passed'
