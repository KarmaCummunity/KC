-- 0528_giving_handoff_notifications.sql | FR-NOTIF-018 (KC#1391): an item or food handoff change
-- pushes the other side, never the side that acted:
--   1. an item request reaches the giver; approval and hand-over reach the requester;
--   2. the giver declining a waiting request reaches the requester as a decline;
--   3. a requester cancelling an approved handoff reaches the giver;
--   4. a food quick claim reaches the giver;
--   5. a system cancel reaches both sides; rides keep their own booking pushes (0511).
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('gh_giver')     as giver,
       kc_test.create_user('gh_requester') as requester;

-- Pushes of one kind queued for one user about one handoff.
create function pg_temp.notified(p_user uuid, p_kind text, p_handoff uuid)
returns bigint
language sql
as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and kind = p_kind and data -> 'params' ->> 'listingId' = (
     select coalesce(
       (select listing_id::text from public.giving_handoffs where handoff_id = p_handoff),
       (select coalesce(public.listing_id_of_post(post_id), post_id)::text from public.post_handoffs where handoff_id = p_handoff)
     ))
     and dedupe_key like p_kind || ':' || p_handoff::text || ':%'
$$;
-- Every giving_handoff_* push queued for one user about one handoff.
create function pg_temp.handoff_pushes(p_user uuid, p_handoff uuid)
returns bigint
language sql
as $$
  select count(*) from public.notifications_outbox
   where user_id = p_user and kind like 'giving_handoff_%' and dedupe_key like '%:' || p_handoff::text || ':%'
$$;
-- 0520: pg_temp helpers are called after act_as, so they need an explicit grant.
grant execute on function pg_temp.notified(uuid, text, uuid) to public;
grant execute on function pg_temp.handoff_pushes(uuid, uuid) to public;

create function pg_temp.item_listing(p_owner uuid, p_title text)
returns uuid
language sql
as $$
  select kc_test.create_listing(p_owner, 'items', 'give_item', 'give', p_title,
                                '{"item_condition":"Good"}'::jsonb);
$$;
grant execute on function pg_temp.item_listing(uuid, text) to public;

-- 1) Request → approval → hand-over.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  -- The fixture acts as the giver; the request is then made as the requester.
  v_listing := pg_temp.item_listing(p.giver, 'gh lamp');
  perform kc_test.act_as(p.requester);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;

  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_requested', v_handoff), 1::bigint,
    'the giver is told about a new request');
  perform kc_test.assert_eq(pg_temp.handoff_pushes(p.requester, v_handoff), 0::bigint,
    'the requester is not told about their own request');
  perform kc_test.assert_eq(
    (select body_args ->> 'name' from public.notifications_outbox
      where user_id = p.giver and kind = 'giving_handoff_requested'
        and dedupe_key like '%:' || v_handoff::text || ':%'),
    'Test gh_requester', 'the request push names the requester');
  perform kc_test.assert_eq(
    (select title_key from public.notifications_outbox
      where user_id = p.giver and kind = 'giving_handoff_requested'
        and dedupe_key like '%:' || v_handoff::text || ':%'),
    'notifications.givingHandoffRequestedTitle', 'the push uses the handoff copy keys');

  perform kc_test.act_as(p.giver);
  perform public.confirm_item_handoff(v_handoff);
  perform kc_test.assert_eq(pg_temp.notified(p.requester, 'giving_handoff_confirmed', v_handoff), 1::bigint,
    'the requester is told the request was approved');

  perform public.mark_giving_handed_over(v_handoff);
  perform kc_test.assert_eq(pg_temp.notified(p.requester, 'giving_handoff_completed', v_handoff), 1::bigint,
    'the requester is asked to rate once the giver marks it handed over');
  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_completed', v_handoff), 0::bigint,
    'the giver who marked it is not pushed');
end $$;

-- 2) The giver declines a waiting request.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  -- The fixture acts as the giver; the request is then made as the requester.
  v_listing := pg_temp.item_listing(p.giver, 'gh chair');
  perform kc_test.act_as(p.requester);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;

  perform kc_test.act_as(p.giver);
  perform public.cancel_giving_handoff(v_handoff);
  perform kc_test.assert_eq(pg_temp.notified(p.requester, 'giving_handoff_declined', v_handoff), 1::bigint,
    'a declined requester is told');
  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_declined', v_handoff)
                              + pg_temp.notified(p.giver, 'giving_handoff_cancelled', v_handoff), 0::bigint,
    'the giver who declined is not pushed');
end $$;

-- 3) The requester cancels an approved handoff.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  -- The fixture acts as the giver; the request is then made as the requester.
  v_listing := pg_temp.item_listing(p.giver, 'gh desk');
  perform kc_test.act_as(p.requester);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;
  perform kc_test.act_as(p.giver);
  perform public.confirm_item_handoff(v_handoff);

  perform kc_test.act_as(p.requester);
  perform public.cancel_giving_handoff(v_handoff);
  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_cancelled', v_handoff), 1::bigint,
    'the giver is told the requester cancelled');
  perform kc_test.assert_eq(pg_temp.notified(p.requester, 'giving_handoff_cancelled', v_handoff), 0::bigint,
    'the requester who cancelled is not pushed');
end $$;

-- 4) A food quick claim is confirmed at once and reaches the giver.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.giver, 'food', 'give_food', 'give', 'gh soup',
    jsonb_build_object('food_type', 'cooked', 'expires_at', now() + interval '1 day'));
  perform kc_test.act_as(p.requester);
  v_handoff := (public.claim_food_giving(v_listing)).handoff_id;

  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_claimed', v_handoff), 1::bigint,
    'the giver is told the food was claimed');
  perform kc_test.assert_eq(pg_temp.handoff_pushes(p.requester, v_handoff), 0::bigint,
    'the claimer is not told about their own claim');
end $$;

-- 5) A system cancel (no caller) reaches both sides; a ride booking gets no handoff push.
do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
  v_ride uuid;
  v_booking uuid;
begin
  select * into p from personas;
  -- The fixture acts as the giver; the request is then made as the requester.
  v_listing := pg_temp.item_listing(p.giver, 'gh shelf');
  perform kc_test.act_as(p.requester);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;

  perform set_config('request.jwt.claims', '', true);
  update public.post_handoffs set status = 'cancelled', cancelled_at = now() where handoff_id = v_handoff;
  if to_regclass('public.giving_handoffs') is not null then
    update public.giving_handoffs set status = 'cancelled', cancelled_at = now() where handoff_id = v_handoff;
  end if;
  perform kc_test.assert_eq(pg_temp.notified(p.giver, 'giving_handoff_cancelled', v_handoff), 1::bigint,
    'a system cancel reaches the giver');
  perform kc_test.assert_eq(pg_temp.notified(p.requester, 'giving_handoff_cancelled', v_handoff), 1::bigint,
    'a system cancel reaches the requester');

  v_ride := kc_test.create_ride_offer(p.giver);
  v_booking := kc_test.book_ride(p.requester, v_ride);
  perform kc_test.assert_eq(pg_temp.handoff_pushes(p.giver, v_booking), 0::bigint,
    'a ride booking keeps its own pushes, not the item / food ones');
end $$;

rollback;

\echo '✓ 0528 giving handoff notifications test passed'
