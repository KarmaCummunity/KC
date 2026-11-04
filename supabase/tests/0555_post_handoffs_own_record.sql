-- supabase/tests/0555_post_handoffs_own_record.sql | 0555 (G1 step 3a, ADR-006, D19): the items
-- and food handoff RPCs write post_handoffs as the record; giving_handoffs is derived (same id,
-- same fields) so the listing-side rules, notifications and readers keep working; the RPCs accept
-- a post id as well as a listing id; the sweeps act on the record; a legacy write on
-- giving_handoffs still mirrors to post_handoffs; the report agrees.

begin;

create temp table personas as
select kc_test.create_user('oh_giver')  as giver,
       kc_test.create_user('oh_taker')  as taker,
       kc_test.create_user('oh_second') as second,
       kc_test.create_user('oh_cook')   as cook,
       kc_test.create_user('oh_eater')  as eater,
       kc_test.create_user('oh_hungry') as hungry;

/** The post_handoffs record with p_id (fails when there is none). */
create function pg_temp.record_of(p_id uuid)
returns public.post_handoffs
language plpgsql
as $$
declare
  v public.post_handoffs;
begin
  select * into v from public.post_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail('handoff has no post_handoffs record');
  end if;
  return v;
end $$;

/** The derived giving_handoffs row with p_id (fails when there is none). */
create function pg_temp.derived_of(p_id uuid)
returns public.giving_handoffs
language plpgsql
as $$
declare
  v public.giving_handoffs;
begin
  select * into v from public.giving_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail('handoff has no derived giving_handoffs row');
  end if;
  return v;
end $$;

/** Both sides of handoff p_id agree on status, recipient, seats, cancel reason and timestamps. */
create function pg_temp.assert_both_sides(p_id uuid, p_status text, p_message text)
returns void
language plpgsql
as $$
declare
  r public.post_handoffs := pg_temp.record_of(p_id);
  g public.giving_handoffs := pg_temp.derived_of(p_id);
begin
  perform kc_test.assert_eq(r.status, p_status, p_message || ': record status');
  perform kc_test.assert_eq(g.status, p_status, p_message || ': derived status');
  perform kc_test.assert_eq(g.listing_id, public.listing_id_of_post(r.post_id), p_message || ': derived listing');
  perform kc_test.assert_true(
    (r.recipient_id, r.seats, r.cancel_reason, r.confirmed_at, r.handed_over_at, r.cancelled_at, r.no_show_at)
      is not distinct from
    (g.recipient_id, g.seats, g.cancel_reason, g.confirmed_at, g.handed_over_at, g.cancelled_at, g.no_show_at),
    p_message || ': both sides carry the same fields');
end $$;

/** An open item offer by p_owner through the app's RPC; returns its listing id. */
create function pg_temp.item_offer(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => p_title,
    p_details => '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    p_city_id => 'tel-aviv');
end $$;

/** An open food offer by p_owner through the app's RPC; returns its listing id. */
create function pg_temp.food_offer(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('food', 'give_food'), p_title => p_title,
    p_details => jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '6 hours')),
    p_city_id => 'tel-aviv');
end $$;

-- ── T1 reserve with the listing id: post_handoffs is the record, giving_handoffs is derived ──
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
  r public.post_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a lamp');
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the item offer has its post');

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_listing, 'pickup', null, null);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'the RPC still returns the giving_handoffs row with its listing id');
  perform kc_test.assert_eq(h.status, 'reserved', 'and the reservation is pending the giver');

  r := pg_temp.record_of(h.handoff_id);
  perform kc_test.assert_eq(r.post_id, v_post, 'the record sits under the post');
  perform kc_test.assert_eq(r.recipient_id, p.taker, 'with the taker as recipient');
  perform kc_test.assert_true(r.confirm_by > now() + interval '23 hours', 'and the 24h confirm window');
  perform pg_temp.assert_both_sides(h.handoff_id, 'reserved', 'after reserve');
  perform kc_test.assert_eq((select availability_status from public.listings where listing_id = v_listing), 'scheduled',
    'the listing shows the item as scheduled');

  -- T2 a second taker is refused by the record's own uniqueness rule
  perform kc_test.act_as(p.second);
  perform kc_test.assert_raises(
    format('select public.reserve_item_giving(%L, ''pickup'', null, null)', v_listing),
    'item_already_reserved', 'one live handoff per item (0382)');

  -- T3 confirm and hand over on the record; the listing closes; karma is awarded once per side
  perform kc_test.act_as(p.giver);
  h := public.confirm_item_handoff(h.handoff_id);
  perform pg_temp.assert_both_sides(h.handoff_id, 'confirmed', 'after confirm');
  h := public.mark_giving_handed_over(h.handoff_id);
  perform pg_temp.assert_both_sides(h.handoff_id, 'handed_over', 'after hand-over');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'closed', 'the listing closed');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', h.handoff_id::text),
    2, 'giver and receiver each earned the hand-over karma once (0453)');

  perform kc_test.assert_raises(
    format('select public.mark_giving_handed_over(%L)', h.handoff_id),
    'handoff_not_confirmed', 'a handed-over handoff cannot be handed over again');
end $$;

-- ── T4 reserve with the post id; a cancel flows both ways including the listing-side reason ──
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a chair');
  v_post := public.post_id_of_listing(v_listing);

  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_post, 'delivery', null, null);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'the post id resolves to the same item');
  perform kc_test.assert_eq((pg_temp.record_of(h.handoff_id)).pickup_mode, 'delivery', 'the pickup mode is kept');

  perform public.cancel_giving_handoff(h.handoff_id);
  perform pg_temp.assert_both_sides(h.handoff_id, 'cancelled', 'after the taker cancels');
  perform kc_test.assert_eq((pg_temp.record_of(h.handoff_id)).cancel_reason, 'passenger_cancelled',
    'the reason the listing side derives (0511) reaches the record');
  perform kc_test.assert_eq((select availability_status from public.listings where listing_id = v_listing), 'immediate',
    'the item is available again');

  perform kc_test.assert_raises(
    format('select public.cancel_giving_handoff(%L)', h.handoff_id),
    'handoff_not_found', 'a cancelled handoff cannot be cancelled again');

  -- An unknown id is refused like a missing listing.
  perform kc_test.assert_raises(
    format('select public.reserve_item_giving(%L, ''pickup'', null, null)', gen_random_uuid()),
    'listing_not_available', 'an id that is neither a post nor a listing');
end $$;

-- ── T5 food: claim with the post id, then the no-show sweep ends the record ──────────────────
do $$
declare
  p personas;
  v_listing uuid;
  h public.giving_handoffs;
  v_swept int;
begin
  select * into p from personas;
  v_listing := pg_temp.food_offer(p.cook, 'lentil soup');

  perform kc_test.act_as(p.eater);
  h := public.claim_food_giving(public.post_id_of_listing(v_listing), null, null);
  perform kc_test.assert_eq(h.listing_id, v_listing, 'the claim resolves the post id to the food offer');
  perform pg_temp.assert_both_sides(h.handoff_id, 'confirmed', 'a food claim is confirmed at once (0383)');

  perform kc_test.act_as(p.second);
  perform kc_test.assert_raises(
    format('select public.claim_food_giving(%L, null, null)', v_listing),
    'listing_not_available', 'a second claim on a live claim is refused with the code the app shows');
  perform kc_test.act_as(p.eater);

  -- The eater never came: the window closed more than two hours ago.
  update public.post_handoffs set pickup_window_end = now() - interval '3 hours' where handoff_id = h.handoff_id;
  perform kc_test.act_as_anon();
  v_swept := public.giving_handoff_no_show_sweep();
  perform kc_test.assert_true(v_swept >= 1, 'the sweep counted the stale claim');
  perform pg_temp.assert_both_sides(h.handoff_id, 'no_show', 'after the no-show sweep');
  perform kc_test.assert_eq((select availability_status from public.listings where listing_id = v_listing), 'immediate',
    'the food is offered again');
end $$;

-- ── T6 food: the expiry sweep cancels the record and the post expires ───────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_listing := pg_temp.food_offer(p.cook, 'bread');
  perform kc_test.act_as(p.eater);
  h := public.claim_food_giving(v_listing, null, null);

  -- now() is frozen inside this transaction, so the offer cannot run out on its own; the 0266
  -- write-time guard would expire it at once, which is the other path. Park it (as 0467 does).
  alter table public.listings disable trigger listings_food_expiry_block;
  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_listing;
  alter table public.listings enable trigger listings_food_expiry_block;
  perform kc_test.act_as(p.cook);
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'open', 'the offer is still open when the sweep runs');
  perform kc_test.act_as_anon();
  perform public.food_expired_listings_sweep();
  perform pg_temp.assert_both_sides(h.handoff_id, 'cancelled', 'after the expiry sweep');
  perform kc_test.assert_eq((pg_temp.record_of(h.handoff_id)).cancel_reason, 'system', 'a sweep cancels as the system');
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'expired', 'the listing expired');
  perform kc_test.assert_eq((select status from public.posts where post_id = public.post_id_of_listing(v_listing)), 'expired',
    'and so did the post (0554)');
end $$;

-- ── T7 the legacy direction still works: a giving_handoffs write mirrors to the record ───────
do $$
declare
  p personas;
  v_listing uuid;
  v_id uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.item_offer(p.giver, 'a table');
  perform kc_test.act_as(p.taker);
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, confirm_by)
  values (v_listing, p.giver, p.taker, 'items', 'reserved', now() + interval '1 day')
  returning handoff_id into v_id;
  perform pg_temp.assert_both_sides(v_id, 'reserved', 'a direct giving_handoffs insert (0553)');

  -- And a write on the record reaches the legacy row, with no echo loop.
  update public.post_handoffs set status = 'confirmed', confirmed_at = now() where handoff_id = v_id;
  perform pg_temp.assert_both_sides(v_id, 'confirmed', 'a direct post_handoffs update');

  delete from public.post_handoffs where handoff_id = v_id;
  perform kc_test.assert_row_count(format('select 1 from public.giving_handoffs where handoff_id = %L', v_id), 0,
    'deleting the record deletes the derived row');
end $$;

-- ── T8 the hourly handoff write cap (0534) counts the record, once ──────────────────────────
do $$
declare
  p personas;
  l1 uuid; l2 uuid; l3 uuid;
begin
  select * into p from personas;
  update public.marketplace_rule_params set param_value = '2'
   where rule_code = 'R-SEC-Handoff-Write' and param_key = 'max_per_hour';
  l1 := pg_temp.item_offer(p.giver, 'rl one');
  l2 := pg_temp.item_offer(p.giver, 'rl two');
  l3 := pg_temp.item_offer(p.giver, 'rl three');
  perform kc_test.act_as(p.hungry);
  perform public.reserve_item_giving(l1, 'pickup', null, null);
  perform public.reserve_item_giving(l2, 'pickup', null, null);
  perform kc_test.assert_raises(
    format('select public.reserve_item_giving(%L, ''pickup'', null, null)', l3),
    'rate_limit_exceeded', 'the third handoff request in an hour is capped on the record');
  perform kc_test.assert_row_count(
    format('select 1 from public.post_handoffs where recipient_id = %L', p.hungry), 2,
    'two records exist; the derived write did not count a third time');
end $$;

-- ── T9 the report agrees on both sides ─────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every giving handoff has its record');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'and both sides agree');
  perform kc_test.assert_row_count(
    'select 1 from public.post_handoffs t where not exists (select 1 from public.giving_handoffs g where g.handoff_id = t.handoff_id)',
    0, 'no record is without its derived row');
end $$;

rollback;
\echo '✓ 0555_post_handoffs_own_record.sql passed'
