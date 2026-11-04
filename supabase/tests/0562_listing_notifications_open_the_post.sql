-- supabase/tests/0562_listing_notifications_open_the_post.sql | 0562 (G1 step 4c, D-220): a
-- notification about a listing names the listing's post, so a tap opens the one detail screen:
--   1. a food claim push carries the post route, the post id and still the listing id, and the
--      in-app notification center copies that route;
--   2. a listing id that is malformed or names no listing leaves the payload unchanged.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('np_giver')   as giver,
       kc_test.create_user('np_claimer') as claimer;

-- ── T1 a listing notification opens the listing's post ─────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_handoff uuid;
  v_outbox public.notifications_outbox;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.giver, 'food', 'give_food', 'give', 'np soup',
    jsonb_build_object('food_type', 'cooked', 'expires_at', now() + interval '1 day'));
  v_post := public.post_id_of_listing(v_listing);
  perform kc_test.assert_true(v_post is not null, 'the published listing has a post (0557)');

  perform kc_test.act_as(p.claimer);
  v_handoff := (public.claim_food_giving(v_listing)).handoff_id;

  select * into v_outbox from public.notifications_outbox
   where user_id = p.giver and kind = 'giving_handoff_claimed'
     and dedupe_key like 'giving_handoff_claimed:' || v_handoff::text || ':%';
  perform kc_test.assert_eq(v_outbox.data ->> 'route', '/post/[id]', 'the push routes to the post');
  perform kc_test.assert_eq(v_outbox.data #>> '{params,postId}', v_post::text, 'it names the post');
  perform kc_test.assert_eq(v_outbox.data #>> '{params,id}', v_post::text, 'as the post route''s id');
  perform kc_test.assert_eq(v_outbox.data #>> '{params,listingId}', v_listing::text,
    'and keeps the listing id for an older app build');

  perform kc_test.assert_eq(
    (select data ->> 'route' from public.notification_inbox where outbox_id = v_outbox.notification_id),
    '/post/[id]', 'the notification center opens the post too');
end $$;

-- ── T2 a listing id without a listing leaves the payload as written ────────────────────────
do $$
declare
  p personas;
  v_unknown text := gen_random_uuid()::text;
  v_data jsonb;
begin
  select * into p from personas;

  insert into public.notifications_outbox (user_id, category, kind, title_key, body_key, data)
  values (p.claimer, 'critical', 'listing_expired', 'notifications.foodExpiredTitle',
          'notifications.foodExpiredBody',
          jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                             'params', jsonb_build_object('listingId', v_unknown)))
  returning data into v_data;
  perform kc_test.assert_eq(v_data ->> 'route', '/(tabs)/donations/marketplace/[listingId]',
    'an unknown listing keeps its listing route');
  perform kc_test.assert_true(v_data #>> '{params,postId}' is null, 'and gets no post id');

  insert into public.notifications_outbox (user_id, category, kind, title_key, body_key, data)
  values (p.claimer, 'critical', 'listing_expired', 'notifications.foodExpiredTitle',
          'notifications.foodExpiredBody',
          jsonb_build_object('params', jsonb_build_object('listingId', 'not-a-uuid')))
  returning data into v_data;
  perform kc_test.assert_eq(v_data #>> '{params,listingId}', 'not-a-uuid',
    'a malformed listing id is left for the app to reject');
  perform kc_test.assert_true(v_data ->> 'route' is null, 'and gets no route');
end $$;

rollback;
\echo '✓ 0562_listing_notifications_open_the_post.sql passed'
