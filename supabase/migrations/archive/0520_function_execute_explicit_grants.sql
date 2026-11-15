-- 0520_function_execute_explicit_grants | #1063 DB function privileges (ADR-002 §2)
--
-- EXECUTE on a function becomes an explicit decision of the migration that creates it:
--
--   1. Default privileges. A function created by `postgres` gets EXECUTE for its owner
--      and service_role only. A schema-scoped ALTER DEFAULT PRIVILEGES can only add to
--      the global default, never remove from it, so PUBLIC is revoked at the global
--      level, and `authenticated` at the `public` schema level where it was granted.
--      Client RPCs grant `authenticated` (and `anon` for public reads) themselves;
--      `scripts/check-rpc-grants.mjs` fails CI when an RPC the app calls lacks it.
--   2. SECURITY DEFINER trigger functions: run by their triggers only, never by a client.
--   3. Internal SECURITY DEFINER helpers, called only by triggers, pg_cron and other
--      SECURITY DEFINER functions (which run as the owner): service_role only.
--
-- Existing grants are only narrowed; no client RPC loses access. Guarded by
-- supabase/tests/0520_function_execute_explicit_grants.sql.

begin;

-- ── 1. Default privileges for functions created from now on ──────────────────
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- ── 2. SECURITY DEFINER trigger functions ────────────────────────────────────
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;

-- ── 3. Internal helpers: service_role only ───────────────────────────────────
-- Notifications outbox writer (triggers, crons and RPCs enqueue through it).
revoke execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb, jsonb, text, boolean)
  from public, anon, authenticated;
-- Matching engine internals (`api_bot_find_matches`, `match_score_pair`).
revoke execute on function public.find_matches(uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function public.effective_geo(public.listings, uuid) from public, anon, authenticated;
-- Listing writers' shared validation (`create_marketplace_listing`, `update_my_listing`).
revoke execute on function public.validate_listing_details(uuid, jsonb) from public, anon, authenticated;
-- Listing ↔ post / ride / feed mirrors (sync triggers, `share_listing_to_feed`).
revoke execute on function public.listing_upsert_from_post(public.posts) from public, anon, authenticated;
revoke execute on function public.listing_upsert_from_ride(public.ride_listings) from public, anon, authenticated;
revoke execute on function public.listing_feed_mirror_upsert(public.listings) from public, anon, authenticated;
revoke execute on function public.listing_feed_mirror_sync_media(uuid, uuid) from public, anon, authenticated;
-- pg_cron sweeps.
revoke execute on function public.food_expired_listings_sweep() from public, anon, authenticated;
revoke execute on function public.giving_handoff_no_show_sweep() from public, anon, authenticated;
revoke execute on function public.karma_recompute_nightly() from public, anon, authenticated;
revoke execute on function public.ride_complete_pending_rating_cleanup() from public, anon, authenticated;

grant execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb, jsonb, text, boolean) to service_role;
grant execute on function public.find_matches(uuid, integer, uuid) to service_role;
grant execute on function public.effective_geo(public.listings, uuid) to service_role;
grant execute on function public.validate_listing_details(uuid, jsonb) to service_role;
grant execute on function public.listing_upsert_from_post(public.posts) to service_role;
grant execute on function public.listing_upsert_from_ride(public.ride_listings) to service_role;
grant execute on function public.listing_feed_mirror_upsert(public.listings) to service_role;
grant execute on function public.listing_feed_mirror_sync_media(uuid, uuid) to service_role;
grant execute on function public.food_expired_listings_sweep() to service_role;
grant execute on function public.giving_handoff_no_show_sweep() to service_role;
grant execute on function public.karma_recompute_nightly() to service_role;
grant execute on function public.ride_complete_pending_rating_cleanup() to service_role;

commit;
