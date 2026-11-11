-- supabase/tests/0559_items_close_through_the_post.sql | 0559 (G1 step 3c, gap G34, D12, D17, D63):
-- one closing system for items. Handing over an item made through the post form closes its post
-- through the post closure — recipient row, closed_delivered, giver 20 + value bonus / receiver 15
-- paid once and reversed by a reopen, no handoff karma, no second "marked as recipient" notice;
-- closing such a post settles its live handoffs; an item with a mirror post keeps the handoff
-- path; no item post is left open after a hand-over.

begin;

create temp table personas as
select kc_test.create_user('ic_giver')  as giver,
       kc_test.create_user('ic_taker')  as taker,
       kc_test.create_user('ic_other')  as other;

/** A Give item made through the post form (it owns an origin-'post' listing, 0243). */
create function pg_temp.item_post(p_owner uuid, p_title text, p_value int default null)
returns uuid
language plpgsql
as $$
declare
  v_post uuid;
begin
  perform kc_test.act_as(p_owner);
  insert into public.posts (owner_id, type, title, category, city, street, street_number, estimated_value)
  values (p_owner, 'Give', p_title, 'Other', 'tel-aviv', 'Herzl', '1', p_value)
  returning post_id into v_post;
  return v_post;
end $$;

/** The sum of the closure karma of post p_post for user p_user. */
create function pg_temp.closure_karma(p_user uuid, p_post uuid)
returns bigint
language sql
as $$
  select coalesce(sum(points_delta), 0) from public.karma_ledger
   where user_id = p_user and ref_type = 'post' and ref_id = p_post::text and event_type like 'closure%';
$$;

/** A confirmed item handoff of post p_post to p_taker; returns its id. */
create function pg_temp.confirmed_handoff(p_post uuid, p_owner uuid, p_taker uuid)
returns uuid
language plpgsql
as $$
declare
  h public.giving_handoffs;
begin
  perform kc_test.act_as(p_taker);
  h := public.reserve_item_giving(p_post, 'pickup', null, null);
  perform kc_test.act_as(p_owner);
  h := public.confirm_item_handoff(h.handoff_id);
  return h.handoff_id;
end $$;

-- ── T0 the 0559 repair left no post-form item post open after a hand-over ──────────────────
do $$
begin
  perform kc_test.assert_row_count(
    $q$select 1 from public.posts p
        where p.world_slug = 'items' and p.listing_id is null and p.status = 'open'
          and exists (select 1 from public.post_handoffs t where t.post_id = p.post_id and t.status = 'handed_over')
          and not exists (select 1 from public.post_handoffs t where t.post_id = p.post_id and t.status in ('reserved', 'confirmed'))$q$,
    0, 'every handed-over post-form item is closed');
end $$;

-- ── T1 handing over a post-form item closes its post; karma and bonus paid once, by the closure ─
create temp table ctx as select null::uuid as post, null::uuid as handoff;
do $$
declare
  p personas;
  v_post uuid;
  v_h uuid;
begin
  select * into p from personas;
  v_post := pg_temp.item_post(p.giver, 'a lamp', 500);
  perform kc_test.assert_true((select listing_id is null from public.posts where post_id = v_post),
    'a post-form item owns its listing');
  v_h := pg_temp.confirmed_handoff(v_post, p.giver, p.taker);

  perform public.mark_giving_handed_over(v_h);

  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'closed_delivered',
    'the hand-over closes the item''s post');
  perform kc_test.assert_eq((select recipient_user_id from public.recipients where post_id = v_post), p.taker,
    'with the taker as its recipient');
  if public.listing_id_of_post(v_post) is not null then
    perform kc_test.assert_eq(kc_test.listing_status(public.listing_id_of_post(v_post)), 'closed', 'the listing follows');
  end if;
  perform kc_test.assert_eq(pg_temp.closure_karma(p.giver, v_post), 30::bigint,
    'the giver earns 20 + the value bonus (500 / 50) through the closure');
  perform kc_test.assert_eq(pg_temp.closure_karma(p.taker, v_post), 15::bigint, 'the receiver earns 15');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', v_h::text),
    0, 'and no handoff karma is paid on top');
  perform kc_test.assert_row_count(
    format('select 1 from public.notifications_outbox where user_id = %L and kind = ''mark_recipient''', p.taker),
    0, 'the taker is not told twice');
  perform kc_test.assert_true(
    exists (select 1 from public.notifications_outbox where user_id = p.taker and kind = 'giving_handoff_completed'),
    'the hand-over notice reaches the taker');
  update ctx set post = v_post, handoff = v_h;
end $$;

-- ── T2 a reopen reverses the closure karma (S20) ─────────────────────────────────────────────
do $$
declare
  p personas;
  c ctx;
begin
  select * into p from personas;
  select * into c from ctx;
  perform kc_test.act_as(p.giver);
  perform public.reopen_post_marked(c.post);
  perform kc_test.assert_eq(pg_temp.closure_karma(p.giver, c.post), 0::bigint, 'the giver''s closure karma is reversed');
  perform kc_test.assert_eq(pg_temp.closure_karma(p.taker, c.post), 0::bigint, 'and the receiver''s');
end $$;

-- ── T3 closing a post-form item post settles its live handoff to the marked recipient ────────
do $$
declare
  p personas;
  v_post uuid;
  v_h uuid;
begin
  select * into p from personas;
  v_post := pg_temp.item_post(p.giver, 'a chair');
  v_h := pg_temp.confirmed_handoff(v_post, p.giver, p.taker);

  perform kc_test.act_as(p.giver);
  perform public.close_post_with_recipient(v_post, p.taker);

  perform kc_test.assert_eq((select status from public.post_handoffs where handoff_id = v_h), 'handed_over',
    'the handoff to the marked recipient is handed over');
  perform kc_test.assert_eq(kc_test.handoff_status(v_h), 'handed_over', 'on the derived row too');
  perform kc_test.assert_eq(pg_temp.closure_karma(p.giver, v_post), 20::bigint, 'the closure pays the giver once');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', v_h::text),
    0, 'and the settled handoff pays nothing on top');
end $$;

-- ── T4 closing it for someone else cancels the waiting taker's handoff ──────────────────────
do $$
declare
  p personas;
  v_post uuid;
  h public.giving_handoffs;
begin
  select * into p from personas;
  v_post := pg_temp.item_post(p.giver, 'a table');
  perform kc_test.act_as(p.taker);
  h := public.reserve_item_giving(v_post, 'pickup', null, null);

  perform kc_test.act_as(p.giver);
  perform public.close_post_with_recipient(v_post, p.other);

  perform kc_test.assert_eq((select status from public.post_handoffs where handoff_id = h.handoff_id), 'cancelled',
    'the waiting taker''s handoff is cancelled');
  perform kc_test.assert_eq((select cancel_reason from public.post_handoffs where handoff_id = h.handoff_id), 'system',
    'by the system');
  perform kc_test.assert_eq(kc_test.handoff_status(h.handoff_id), 'cancelled', 'on the derived row too');
end $$;

-- ── T5 an item with a mirror post keeps the handoff path ────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_h uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('items', 'give_item'), p_title => 'a radio',
    p_details => '{"item_condition":"Good"}'::jsonb, p_city_id => 'tel-aviv');
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true((select listing_id is not null from public.posts where post_id = v_post),
    'a marketplace item has a mirror post');
  v_h := pg_temp.confirmed_handoff(v_post, p.giver, p.taker);

  perform public.mark_giving_handed_over(v_h);
  perform kc_test.assert_eq(kc_test.listing_status(v_listing), 'closed', 'the listing closes');
  perform kc_test.assert_eq((select status from public.posts where post_id = v_post), 'closed_delivered',
    'and its mirror post follows');
  perform kc_test.assert_row_count(
    format('select 1 from public.karma_ledger where ref_type = ''giving_handoff'' and ref_id = %L', v_h::text),
    2, 'the handoff pays giver and receiver (0453)');
  perform kc_test.assert_eq(pg_temp.closure_karma(p.giver, v_post), 0::bigint, 'and no closure karma on the mirror');
end $$;

rollback;
\echo '✓ 0559_items_close_through_the_post.sql passed'
