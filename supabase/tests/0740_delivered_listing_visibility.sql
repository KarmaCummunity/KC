-- supabase/tests/0740_delivered_listing_visibility.sql | 0740 (FR-POST-021 AC2/AC3, spec 07 §7.7):
-- who sees a delivered listing, and the recipient row of items / food hand-overs.
--   1. food hand-over records the recipient (profile closed tab, no extra karma);
--   2. the visibility matrix: owner surface × recipient surface × viewer role, on the post
--      screen (is_post_visible_to) and the listing screen (post_listing_visible_to);
--   3. a Private profile shows its deliveries to followers only;
--   4. the recipient sees the listing before and after rating (and by handoff alone);
--   5. guests open a Public delivered listing; an admin sees every one;
--   6. an items hand-over records the recipient once, pays one karma row;
--   7. the backfill is idempotent and silent.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('dlv_giver') as giver,
       kc_test.create_user('dlv_receiver') as receiver,
       kc_test.create_user('dlv_giver_follower') as fo,
       kc_test.create_user('dlv_receiver_follower') as fr,
       kc_test.create_user('dlv_stranger') as stranger,
       kc_test.create_user('dlv_admin') as admin_user,
       kc_test.create_user('dlv_item_giver') as item_giver,
       kc_test.create_user('dlv_item_receiver') as item_receiver;

insert into public.admin_role_grants (user_id, role) select admin_user, 'moderator' from personas;
select kc_test.act_as((select fo from personas));
insert into public.follow_edges (follower_id, followed_id) select fo, giver from personas;
select kc_test.act_as((select fr from personas));
insert into public.follow_edges (follower_id, followed_id) select fr, receiver from personas;

create function pg_temp.deliver_food(p_giver uuid, p_receiver uuid, p_title text default 'Delivered cookies')
returns uuid language plpgsql as $$
declare
  v_listing uuid;
  v_handoff uuid;
begin
  v_listing := kc_test.create_listing(p_giver, 'food', 'give_food', 'give', p_title,
    jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '2 days'),
                       'allergens', jsonb_build_array('gluten')),
    p_expires_at => null);
  perform kc_test.act_as(p_receiver);
  v_handoff := (public.claim_food_giving(v_listing)).handoff_id;
  perform kc_test.act_as(p_giver);
  perform public.mark_giving_handed_over(v_handoff);
  return v_listing;
end $$;

create function pg_temp.post_of(p_listing uuid) returns uuid language sql as $$
  select public.post_id_of_listing(p_listing)
$$;

create function pg_temp.sees_post(p_post uuid, p_viewer uuid) returns boolean language sql as $$
  select public.is_post_visible_to(p, p_viewer) from public.posts p where p.post_id = p_post
$$;

create function pg_temp.sees_listing(p_post uuid, p_viewer uuid) returns boolean language sql as $$
  select public.post_listing_visible_to(p, p_viewer) from public.posts p where p.post_id = p_post
$$;

create function pg_temp.set_surface(p_post uuid, p_user uuid, p_surface text) returns void language sql as $$
  insert into public.post_actor_identity (post_id, user_id, surface_visibility, identity_visibility, hide_from_counterparty)
  values (p_post, p_user, p_surface, 'Public', false)
  on conflict (post_id, user_id) do update set surface_visibility = excluded.surface_visibility
$$;

create function pg_temp.admits(p_surface text, p_follows boolean) returns boolean language sql immutable as $$
  select case p_surface when 'Public' then true when 'FollowersOnly' then p_follows else false end
$$;

-- ── T1 a food hand-over records its recipient ────────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver);
  v_post := pg_temp.post_of(v_listing);

  perform kc_test.assert_eq((select status::text from public.posts where post_id = v_post), 'closed_delivered',
    'the hand-over closes the food post');
  perform kc_test.assert_row_count(format(
    'select 1 from public.recipients where post_id = %L and recipient_user_id = %L', v_post, p.receiver), 1,
    'a food hand-over records the recipient (0740)');
  perform kc_test.assert_row_count(format(
    'select 1 from public.profile_closed_posts(%L, %L) where post_id = %L and identity_role = %L',
    p.receiver, p.receiver, v_post, 'respondent'), 1, 'the delivered food reaches the recipient''s closed-posts tab');
  perform kc_test.assert_row_count(format(
    'select 1 from public.karma_ledger where ref_id = %L and event_type like %L', v_post::text, 'closure%'), 0,
    'food keeps per-handoff karma: the recipient row triggers no closure karma');
  perform kc_test.assert_row_count(format(
    'select 1 from public.karma_ledger where user_id = %L and event_type = %L', p.receiver, 'giving_handoff_receiver'), 1,
    'the food receiver is paid once, by the handoff');
end $$;

-- ── T2 the matrix: owner surface × recipient surface × viewer ────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_so text;
  v_sr text;
  v_case text;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver, 'Matrix cookies');
  v_post := pg_temp.post_of(v_listing);

  foreach v_so in array array['Public', 'FollowersOnly', 'OnlyMe'] loop
    foreach v_sr in array array['Public', 'FollowersOnly', 'OnlyMe'] loop
      perform pg_temp.set_surface(v_post, p.giver, v_so);
      perform pg_temp.set_surface(v_post, p.receiver, v_sr);
      v_case := format('owner %s / recipient %s: ', v_so, v_sr);

      -- Always: the owner and the recipient.
      perform kc_test.assert_true(pg_temp.sees_post(v_post, p.giver) and pg_temp.sees_listing(v_post, p.giver),
        v_case || 'the owner sees it');
      perform kc_test.assert_true(pg_temp.sees_post(v_post, p.receiver) and pg_temp.sees_listing(v_post, p.receiver),
        v_case || 'the recipient sees it');
      -- An admin sees every delivered listing.
      perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.admin_user), v_case || 'an admin sees the listing');

      -- Union of the two surfaces for everyone else.
      perform kc_test.assert_eq(pg_temp.sees_post(v_post, p.fo),
        pg_temp.admits(v_so, true) or pg_temp.admits(v_sr, false), v_case || 'follower of the owner (post)');
      perform kc_test.assert_eq(pg_temp.sees_listing(v_post, p.fo),
        pg_temp.admits(v_so, true) or pg_temp.admits(v_sr, false), v_case || 'follower of the owner (listing)');
      perform kc_test.assert_eq(pg_temp.sees_post(v_post, p.fr),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, true), v_case || 'follower of the recipient (post)');
      perform kc_test.assert_eq(pg_temp.sees_listing(v_post, p.fr),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, true), v_case || 'follower of the recipient (listing)');
      perform kc_test.assert_eq(pg_temp.sees_post(v_post, p.stranger),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, false), v_case || 'a member (post)');
      perform kc_test.assert_eq(pg_temp.sees_listing(v_post, p.stranger),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, false), v_case || 'a member (listing)');
      perform kc_test.assert_eq(pg_temp.sees_post(v_post, null),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, false), v_case || 'a guest (post)');
      perform kc_test.assert_eq(pg_temp.sees_listing(v_post, null),
        pg_temp.admits(v_so, false) or pg_temp.admits(v_sr, false), v_case || 'a guest (listing)');
    end loop;
  end loop;
end $$;

-- ── T3 a Private profile shows its deliveries to followers only ───────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver, 'Private profile cookies');
  v_post := pg_temp.post_of(v_listing);

  -- The giver hides the post; the recipient left the default (Public) but has a Private profile.
  perform pg_temp.set_surface(v_post, p.giver, 'OnlyMe');
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.stranger), 'recipient default Public: a member sees it');
  update public.users set privacy_mode = 'Private' where user_id = p.receiver;
  perform kc_test.assert_true(not pg_temp.sees_listing(v_post, p.stranger),
    'recipient with a Private profile: a member who does not follow does not see it');
  perform kc_test.assert_true(not pg_temp.sees_listing(v_post, null), 'recipient with a Private profile: a guest does not');
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.fr), 'recipient with a Private profile: its follower sees it');
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.receiver), 'recipient with a Private profile: it sees it');
  update public.users set privacy_mode = 'Public' where user_id = p.receiver;

  -- An owner with a Private profile and the default surface (the post's visibility, Public).
  delete from public.post_actor_identity where post_id = v_post;
  update public.users set privacy_mode = 'Private' where user_id = p.giver;
  perform pg_temp.set_surface(v_post, p.receiver, 'OnlyMe');
  perform kc_test.assert_true(not pg_temp.sees_listing(v_post, p.stranger), 'owner with a Private profile: a member does not see it');
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.fo), 'owner with a Private profile: its follower sees it');
  update public.users set privacy_mode = 'Public' where user_id = p.giver;
end $$;

-- ── T4 the recipient sees the listing and can rate, before and after rating ───────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver, 'Rating cookies');
  v_post := pg_temp.post_of(v_listing);
  v_handoff := (select handoff_id from public.post_handoffs where post_id = v_post and status = 'handed_over');

  -- The owner chose OnlyMe; the recipient still opens the listing.
  perform pg_temp.set_surface(v_post, p.giver, 'OnlyMe');
  perform pg_temp.set_surface(v_post, p.receiver, 'OnlyMe');
  perform kc_test.act_as(p.receiver);
  perform kc_test.assert_true(public.get_marketplace_listing_detail(v_listing) is not null,
    'OnlyMe both sides: the recipient opens the listing detail');
  perform kc_test.assert_true(public.get_listing_handoff(v_listing) is not null,
    'the recipient gets the handed-over handoff to rate');

  -- The recipient is found through the handoff alone, without a recipients row.
  alter table public.recipients disable trigger user;
  delete from public.recipients where post_id = v_post;
  alter table public.recipients enable trigger user;
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.receiver), 'by handed_over handoff alone, the recipient sees it');
  perform kc_test.assert_true(not pg_temp.sees_listing(v_post, p.stranger), 'a member still does not (OnlyMe both sides)');

  perform public.rate_giving_handoff(v_handoff, 5::smallint, 'Great');
  perform kc_test.assert_true(public.get_marketplace_listing_detail(v_listing) is not null,
    'after rating, the recipient still opens the listing');
  perform kc_test.assert_true(public.get_listing_handoff(v_listing) is null,
    'after rating, the rating form goes away (get_listing_handoff is unchanged)');
end $$;

-- ── T5 guests open a Public delivered listing ─────────────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver, 'Guest cookies');
  v_post := pg_temp.post_of(v_listing);
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.get_marketplace_listing_detail(v_listing) is not null,
    'a guest opens a Public delivered listing');
  perform kc_test.act_as(p.admin_user);
  perform pg_temp.set_surface(v_post, p.giver, 'OnlyMe');
  perform pg_temp.set_surface(v_post, p.receiver, 'OnlyMe');
  perform kc_test.assert_true(public.get_marketplace_listing_detail(v_listing) is not null,
    'an admin opens a delivered listing both sides hid');
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(public.get_marketplace_listing_detail(v_listing) is null,
    'a guest does not once both sides chose OnlyMe');
end $$;

-- ── T6 an items hand-over records the recipient once and pays one karma row ───────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := kc_test.create_listing(p.item_giver, 'items', 'give_item', 'give', 'Delivered lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb);
  v_post := pg_temp.post_of(v_listing);
  perform kc_test.act_as(p.item_receiver);
  v_handoff := (public.reserve_item_giving(v_post, 'pickup', null, null)).handoff_id;
  perform kc_test.act_as(p.item_giver);
  perform public.confirm_item_handoff(v_handoff);
  perform public.mark_giving_handed_over(v_handoff);

  perform kc_test.assert_row_count(format(
    'select 1 from public.recipients where post_id = %L and recipient_user_id = %L', v_post, p.item_receiver), 1,
    'an items hand-over records the recipient once');
  perform kc_test.assert_row_count(format(
    'select 1 from public.karma_ledger where user_id = %L and event_type in (%L, %L)',
    p.item_receiver, 'closure_receiver', 'giving_handoff_receiver'), 1,
    'the items receiver is paid exactly once (closure or handoff, never both)');
  perform kc_test.assert_true(pg_temp.sees_listing(v_post, p.item_receiver), 'the items recipient sees the delivered listing');
end $$;

-- ── T7 the backfill statement is idempotent and silent ────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_post uuid;
  v_before integer;
begin
  select * into p from personas;
  v_listing := pg_temp.deliver_food(p.giver, p.receiver, 'Backfill cookies');
  v_post := pg_temp.post_of(v_listing);
  alter table public.recipients disable trigger user;
  delete from public.recipients where post_id = v_post;
  alter table public.recipients enable trigger user;
  select count(*) into v_before from public.notifications_outbox;

  for i in 1..2 loop
    perform set_config('kc.closing_from_handoff', 'on', true);
    insert into public.recipients (post_id, recipient_user_id, marked_at)
    select distinct on (h.post_id) h.post_id, h.recipient_id, coalesce(h.handed_over_at, now())
      from public.post_handoffs h
      join public.posts po on po.post_id = h.post_id
     where h.status = 'handed_over'
       and h.world_slug in ('items', 'food', 'animals')
       and po.status = 'closed_delivered'
       and h.recipient_id <> po.owner_id
       and not exists (select 1 from public.recipients r where r.post_id = h.post_id)
     order by h.post_id, h.handed_over_at desc nulls last
    on conflict (post_id) do nothing;
    perform set_config('kc.closing_from_handoff', '', true);
  end loop;

  perform kc_test.assert_row_count(format(
    'select 1 from public.recipients where post_id = %L and recipient_user_id = %L', v_post, p.receiver), 1,
    'the backfill restores the missing recipient row, once');
  perform kc_test.assert_eq((select count(*) from public.notifications_outbox)::integer, v_before,
    'the backfill queues no notification');
end $$;

rollback;

\echo '✓ 0740_delivered_listing_visibility.sql passed'
