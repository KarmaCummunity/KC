-- supabase/tests/0693_fsm_retire_legacy_ride_jobs.sql
-- Wave 1d (#1989): the jobs written for the legacy ride tables are gone, ride requests never
-- expire (D21), and the food expiry sweep works on the post record alone. Runs in a
-- rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w1d_giver')    as giver,
       kc_test.create_user('w1d_receiver') as receiver,
       kc_test.create_user('w1d_rider')    as rider;

-- ── 1. The legacy ride jobs and their functions are gone ───────────────────────
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.ride_listings_expire_check()',
    'public.ride_templates_materialize()',
    'public.ride_complete_pending_rating_cleanup()',
    'public.ride_food_overdue_alert()',
    'public.ride_participants_expire_stale_check()'
  ] loop
    perform kc_test.assert_true(to_regprocedure(v_fn) is null, format('%s is dropped', v_fn));
  end loop;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform kc_test.assert_eq(
      (select count(*) from cron.job where jobname in (
        'ride_listings_expire_check', 'ride_templates_materialize',
        'ride_complete_pending_rating_cleanup_daily', 'ride_food_overdue_alert_30m',
        'ride_participants_expire_stale_check')),
      0::bigint, 'no legacy ride job is scheduled');
  end if;
end $$;

-- ── 2. A ride request past its departure stays open (D21: requests never expire) ──
do $$
declare
  p personas;
  v_request uuid;
begin
  select * into p from personas;
  v_request := kc_test.create_listing(p.rider, 'rides', 'ride_request', 'request', 'Need a ride',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object(
      'departs_at', kc_test.iso_in(interval '1 hour'), 'passengers', 1));
  update public.ride_post_details
     set departs_at = now() - interval '5 hours'
   where post_id = v_request;

  perform public.rides_expired_listings_sweep();
  perform public.ride_series_sweep();

  perform kc_test.assert_eq((select status from public.posts where post_id = v_request), 'open',
    'a departed one-off ride request stays open');
end $$;

-- ── 3. Food expiry: open handoffs cancelled, post expired, owner notified once ──
do $$
declare
  p personas;
  v_offer uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_offer := kc_test.create_listing(p.giver, 'food', 'give_food', 'give', 'Soup for tonight',
    jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '2 days'),
                       'allergens', jsonb_build_array('gluten')),
    p_expires_at => null);
  perform kc_test.act_as(p.receiver);
  v_handoff := (public.claim_food_giving(v_offer)).handoff_id;
  -- Backdate the expiry as the hour passing would: the write-time world rules reject a past
  -- food expiry, so they are off for this one statement (as in flows/food_lifecycle.sql).
  alter table public.posts disable trigger posts_before_write_world_rules;
  update public.posts set expires_at = now() - interval '1 minute' where post_id = v_offer;
  alter table public.posts enable trigger posts_before_write_world_rules;

  perform kc_test.assert_true(public.food_expired_listings_sweep() >= 1, 'the sweep expires the offer');
  perform kc_test.assert_eq((select status from public.posts where post_id = v_offer), 'expired',
    'the food post is expired');
  perform kc_test.assert_eq(kc_test.handoff_status(v_handoff), 'cancelled',
    'its open handoff is cancelled');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.giver and kind = 'listing_expired'),
    1::bigint, 'the giver is notified once');

  perform public.food_expired_listings_sweep();
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.giver and kind = 'listing_expired'),
    1::bigint, 'a second run changes nothing');
end $$;

rollback;

\echo '✓ 0693_fsm_retire_legacy_ride_jobs.sql passed'
