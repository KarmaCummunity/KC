-- supabase/tests/0636_g1_match_delivery_on_posts.sql | 0636 (G1 step 6a-6d, issue #1671): the match
-- readers read the record of a post-owned listing (listing_record_of, 0635).
--
-- The oracles are the pre-0636 bodies (rpc_my_matches 0422, api_bot_my_matches 0434), copied
-- verbatim as pg_temp functions. Shapes as in the 0635 test (post-owned and listing-sourced ride
-- offers and requests, an items post and an items request); for every participant the RPC's rows
-- equal the oracle's as ordered JSON text at every stage: created, a pair accepted by both sides, a
-- post-owned offer held for moderation, a post-owned request paused, an accepted pair whose request
-- is paused, a post-owned offer fulfilled. Then a post-owned request whose listing reads paused while
-- its post is open (written with the listings → posts sync off): only the new bodies still show its
-- pair — the proof that the record is read (visibility reads the post since 0628). match_deliver_pending, rpc_match_respond and api_match_llm_pending
-- are unchanged by 0636 (they read titles, creation times and ids only).
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('m6_driver_a') as driver_a,
       kc_test.create_user('m6_driver_b') as driver_b,
       kc_test.create_user('m6_rider_a')  as rider_a,
       kc_test.create_user('m6_rider_b')  as rider_b,
       kc_test.create_user('m6_giver')    as giver,
       kc_test.create_user('m6_seeker')   as seeker;

-- Listings committed by earlier test files share one transaction's now(), and the sweep orders by
-- created_at with no tiebreaker under a batch limit: break the ties (a microsecond apart, keeping
-- the order of distinct times) so the old and the new sweep pick the same batch.
update public.listings l
   set created_at = l.created_at - r.n * interval '1 microsecond'
  from (select listing_id, row_number() over (partition by created_at order by listing_id) - 1 as n
          from public.listings) r
 where l.listing_id = r.listing_id and r.n > 0;

create temp table fx (name text primary key, listing_id uuid);
grant all on fx to public;

/** The route both rides share, with a departure p_in from now. */
create function pg_temp.ride(p_in interval, p_extra jsonb)
returns jsonb
language sql
as $$ select kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(p_in)) || p_extra $$;
grant execute on function pg_temp.ride(interval, jsonb) to public;

-- ── Fixture ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver_a);
  insert into fx values ('owned_offer', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Tel Aviv to Jerusalem',
    p_details => pg_temp.ride(interval '3 hours', '{"seats_available": 3}'), p_city_id => 'tel-aviv'));
  perform kc_test.act_as(p.rider_a);
  insert into fx values ('owned_request', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_request'), p_title => 'Need a ride to Jerusalem',
    p_details => pg_temp.ride(interval '3 hours 20 minutes', '{"passengers": 1}'), p_city_id => 'tel-aviv'));
  insert into fx values ('direct_offer', kc_test.create_listing(p.driver_b, 'rides', 'ride_offer', 'give',
    'Driving to Jerusalem', pg_temp.ride(interval '3 hours 10 minutes', '{"seats_available": 2}')));
  insert into fx values ('direct_request', kc_test.create_listing(p.rider_b, 'rides', 'ride_request', 'request',
    'Ride to Jerusalem please', pg_temp.ride(interval '3 hours 30 minutes', '{"passengers": 1}')));

  perform kc_test.act_as(p.giver);
  insert into public.posts (owner_id, type, title, category, city, street, street_number, item_condition)
  values (p.giver, 'Give', 'Grey sofa', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_post;
  insert into fx select 'items_post', listing_id from public.listings where legacy_post_id = v_post;
  insert into fx values ('items_request', kc_test.create_listing(p.seeker, 'items', 'request_item', 'request',
    'Grey sofa needed', '{}'::jsonb));
  update public.listings set category_id = (select category_id from public.listings l join fx using (listing_id) where fx.name = 'items_post')
   where listing_id = (select listing_id from fx where name = 'items_request');
end $$;

-- ── Oracles: the pre-0636 bodies ────────────────────────────────────────────────────────────────

create function pg_temp.old_my_matches(p_limit integer default 20)
returns table (
  candidate_id        uuid,
  status              text,
  score               numeric,
  components          jsonb,
  distance_km         numeric,
  world_slug          text,
  my_role             text,
  my_listing_id       uuid,
  my_listing_title    text,
  other_listing_id    uuid,
  other_listing_title text,
  other_listing_summary text,
  other_owner_id      uuid,
  other_owner_name    text,
  other_owner_avatar  text,
  other_owner_handle  text,
  my_response         text,
  other_response      text,
  llm_reason          text,
  created_at          timestamptz
)
language sql
stable
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select m.*,
           case when m.offer_owner_id = me.uid then 'offer' else 'request' end as role
      from public.match_candidates m, me
     where me.uid is not null
       and m.status in ('suggested', 'accepted')
       and (m.offer_owner_id = me.uid or m.request_owner_id = me.uid)
  )
  select x.candidate_id,
         x.status,
         public.match_effective_score(x.score, x.llm_score),
         x.components,
         x.distance_km,
         x.world_slug,
         x.role,
         own.listing_id,
         own.title,
         oth.listing_id,
         oth.title,
         oth.summary,
         u.user_id,
         u.display_name,
         u.avatar_url,
         u.share_handle,
         case when x.role = 'offer' then x.offer_response else x.request_response end,
         case when x.role = 'offer' then x.request_response else x.offer_response end,
         case when (select s.llm_rerank_enabled from public.matching_settings s where s.id) then x.llm_reason end,
         x.created_at
    from mine x
    cross join me
    join public.listings own on own.listing_id = case when x.role = 'offer' then x.offer_listing_id else x.request_listing_id end
    join public.listings oth on oth.listing_id = case when x.role = 'offer' then x.request_listing_id else x.offer_listing_id end
    join public.users u on u.user_id = oth.owner_id
   where (case when x.role = 'offer' then x.offer_response else x.request_response end) is distinct from 'declined'
     and (x.status = 'accepted' or (own.status = 'open' and oth.status = 'open'))
     and public.is_listing_visible_to(oth, me.uid)
   order by (x.status = 'accepted') desc, public.match_effective_score(x.score, x.llm_score) desc, x.computed_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function pg_temp.old_bot_my_matches(p_user_id uuid, p_limit int default 10)
returns table (
  candidate_id uuid,
  world_slug text,
  score numeric,
  status text,
  my_listing_title text,
  other_listing_id uuid,
  other_title text,
  distance_km numeric
)
language sql
stable
set search_path = public
as $$
  select m.candidate_id, m.world_slug, m.score, m.status,
         mine.title,
         other.listing_id, other.title, m.distance_km
    from public.match_candidates m
    join public.listings mine
      on mine.listing_id = case when m.offer_owner_id = p_user_id
                                then m.offer_listing_id else m.request_listing_id end
    join public.listings other
      on other.listing_id = case when m.offer_owner_id = p_user_id
                                 then m.request_listing_id else m.offer_listing_id end
   where (m.offer_owner_id = p_user_id or m.request_owner_id = p_user_id)
     and m.status in ('suggested', 'accepted')
     and other.status = 'open'
     and other.visibility = 'Public'
   order by m.score desc, m.computed_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

/** Compares two set-returning calls, row for row and byte for byte (as ordered JSON text). */
create function pg_temp.rows_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinality), ''[]'')::text from %s with ordinality x', p_sql) into v;
  return v;
end $$;
grant execute on function pg_temp.rows_of(text) to public;

/** Every participant's matches and bot matches agree with their oracles. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_user uuid;
begin
  select * into p from personas;
  foreach v_user in array array[p.driver_a, p.driver_b, p.rider_a, p.rider_b, p.giver, p.seeker] loop
    perform kc_test.act_as(v_user);
    perform kc_test.assert_eq(pg_temp.rows_of('public.rpc_my_matches(50)'), pg_temp.rows_of('pg_temp.old_my_matches(50)'),
      format('%s: my matches of %s', p_stage, v_user));
    perform kc_test.assert_eq(pg_temp.rows_of(format('public.api_bot_my_matches(%L, 25)', v_user)),
      pg_temp.rows_of(format('pg_temp.old_bot_my_matches(%L, 25)', v_user)),
      format('%s: bot matches of %s', p_stage, v_user));
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text) to public;

/** The pair of two fixture listings, if any. */
create function pg_temp.pair(p_offer text, p_request text)
returns uuid
language sql
as $$
  select m.candidate_id from public.match_candidates m
   where m.offer_listing_id = (select listing_id from fx where name = p_offer)
     and m.request_listing_id = (select listing_id from fx where name = p_request)
$$;
grant execute on function pg_temp.pair(text, text) to public;

-- ── Stages ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver_b);
  perform kc_test.assert_true(pg_temp.rows_of('public.rpc_my_matches(50)') like '%other_listing_id%',
    'the fixture matches: the comparisons are not empty');
  perform pg_temp.assert_same('created');

  -- Both sides accept the listing-sourced pair.
  perform kc_test.assert_true(pg_temp.pair('direct_offer', 'direct_request') is not null, 'the direct rides match');
  perform kc_test.act_as(p.driver_b);
  perform public.rpc_match_respond(pg_temp.pair('direct_offer', 'direct_request'), 'accept');
  perform kc_test.act_as(p.rider_b);
  perform public.rpc_match_respond(pg_temp.pair('direct_offer', 'direct_request'), 'accept');
  perform pg_temp.assert_same('a pair accepted');

  update public.listings set moderation_status = 'pending_review' where listing_id = (select listing_id from fx where name = 'owned_offer');
  perform pg_temp.assert_same('a post-owned offer held');
  update public.listings set moderation_status = 'published' where listing_id = (select listing_id from fx where name = 'owned_offer');

  perform kc_test.act_as(p.rider_a);
  perform public.pause_my_listing((select listing_id from fx where name = 'owned_request'));
  perform kc_test.act_as(p.rider_b);
  perform public.pause_my_listing((select listing_id from fx where name = 'direct_request'));
  perform pg_temp.assert_same('a post-owned request paused, an accepted pair''s request paused');

  perform kc_test.act_as(p.rider_a);
  perform public.resume_my_listing((select listing_id from fx where name = 'owned_request'));
  perform kc_test.act_as(p.driver_a);
  perform public.fulfill_my_listing((select listing_id from fx where name = 'owned_offer'));
  perform pg_temp.assert_same('resumed, a post-owned offer fulfilled');
end $$;

-- ── The record is read: a listing that reads paused while its post is open ──────────────────
do $$
declare
  p personas;
  v_request uuid := (select listing_id from fx where name = 'owned_request');
  v_old text;
  v_new text;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver_b);
  perform kc_test.assert_true(pg_temp.rows_of('public.rpc_my_matches(50)') like '%' || v_request || '%',
    'the post-owned request is among the driver''s matches');
  -- Neither the listings → posts sync nor the match trigger (which would expire the pair) runs.
  alter table public.listings disable trigger listings_feed_mirror_sync;
  alter table public.listings disable trigger listings_match_v2;
  update public.listings set status = 'cancelled' where listing_id = v_request;
  alter table public.listings enable trigger listings_match_v2;
  alter table public.listings enable trigger listings_feed_mirror_sync;
  perform kc_test.assert_eq((select status from public.posts where post_id = public.post_id_of_listing(v_request)), 'open',
    'the post is still open');
  v_old := pg_temp.rows_of('pg_temp.old_my_matches(50)');
  v_new := pg_temp.rows_of('public.rpc_my_matches(50)');
  perform kc_test.assert_true(v_old not like '%' || v_request || '%', 'the listing-only read hides the pair');
  perform kc_test.assert_true(v_new like '%' || v_request || '%', 'the record says open: the pair is shown');
  perform kc_test.assert_true(pg_temp.rows_of(format('pg_temp.old_bot_my_matches(%L, 25)', p.driver_b)) not like '%' || v_request || '%',
    'the bot''s listing-only read hides it');
  perform kc_test.assert_true(pg_temp.rows_of(format('public.api_bot_my_matches(%L, 25)', p.driver_b)) like '%' || v_request || '%',
    'the bot shows it on its record');
end $$;

rollback;
\echo '✓ 0636_g1_match_delivery_on_posts.sql passed'
