-- 0464 (KC#1297) — FR-CHAT-004 / FR-CHAT-014: a chat started from a listing opens and shows
-- that listing; a later entry point (another listing, a post, a ride) becomes the chat's one
-- context.

begin;

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(), jsonb_build_object('full_name', p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, account_status = 'active', onboarding_state = 'completed',
         privacy_mode = 'Public'
   where user_id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

/** An open, public items "give" listing created through the app's RPC. */
create or replace function pg_temp.mk_listing(p_owner uuid, p_title text)
returns uuid language plpgsql as $$
begin
  perform pg_temp.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item'),
    p_title   => p_title,
    p_details => '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb,
    p_lat     => 32.0853,
    p_lng     => 34.7818
  );
end $$;

do $$
declare
  v_giver  uuid := pg_temp.mk_user('c464_giver');
  v_taker  uuid := pg_temp.mk_user('c464_taker');
  v_shelf  uuid := pg_temp.mk_listing(v_giver, 'Bookshelf');
  v_lamp   uuid := pg_temp.mk_listing(v_giver, 'Desk lamp');
  v_post   uuid;
  v_ride   uuid;
  v_chat   uuid;
  v_again  uuid;
  v_row    public.chats;
begin
  -- T1: the first contact from a listing opens a chat anchored to it, with the opener message.
  perform pg_temp.act_as(v_taker);
  v_chat := public.start_listing_chat(v_shelf, 'Is the bookshelf still available?');
  select * into v_row from public.chats where chat_id = v_chat;
  perform pg_temp.assert(v_row.anchor_listing_id = v_shelf, 'the new chat is not anchored to the listing');
  perform pg_temp.assert(not v_row.is_support_thread, 'a listing chat must be an ordinary chat');
  perform pg_temp.assert((select count(*) from public.messages where chat_id = v_chat and sender_id = v_taker) = 1,
    'the opener message was not sent');

  -- T2: the same listing again reuses the chat; another listing of the same giver moves the anchor.
  v_again := public.start_listing_chat(v_shelf, null);
  perform pg_temp.assert(v_again = v_chat, 'contacting the same listing again opened a second chat');
  v_again := public.start_listing_chat(v_lamp, null);
  perform pg_temp.assert(v_again = v_chat, 'a second listing of the same giver opened a second chat');
  perform pg_temp.assert((select anchor_listing_id from public.chats where chat_id = v_chat) = v_lamp,
    'the chat still shows the first listing');

  -- T3: a post entry replaces the listing context, and a listing entry replaces the post context.
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number)
  values (gen_random_uuid(), v_giver, 'Give', 'Kids bike', 'd',
          (select city_id from public.cities limit 1), 'St', '1')
  returning post_id into v_post;
  perform pg_temp.act_as(v_taker);
  select * into v_row from public.rpc_chat_set_anchor(v_chat, v_post);
  perform pg_temp.assert(v_row.anchor_post_id = v_post and v_row.anchor_listing_id is null,
    'a post entry must replace the listing context');
  perform public.start_listing_chat(v_shelf, null);
  select * into v_row from public.chats where chat_id = v_chat;
  perform pg_temp.assert(v_row.anchor_listing_id = v_shelf and v_row.anchor_post_id is null,
    'a listing entry must replace the post context');

  -- T4: a ride entry replaces the listing context.
  insert into public.ride_listings (owner_id, mode, origin_city_id, dest_city_id, departs_at, title,
                                    origin_street, dest_street)
  values (v_giver, 'request', (select city_id from public.cities order by city_id limit 1),
          (select city_id from public.cities order by city_id desc limit 1),
          now() + interval '2 days', 'Ride north wanted', 'A', 'B')
  returning ride_id into v_ride;
  perform pg_temp.act_as(v_taker);
  select * into v_row from public.rpc_chat_set_anchor_ride(v_chat, v_ride);
  perform pg_temp.assert(v_row.anchor_ride_id = v_ride and v_row.anchor_listing_id is null,
    'a ride entry must replace the listing context');

  -- T5: a chat the caller hid from their inbox is not reused (FR-CHAT-016); a new one opens.
  update public.chats
     set inbox_hidden_at_a = case when participant_a = v_taker then now() else inbox_hidden_at_a end,
         inbox_hidden_at_b = case when participant_b = v_taker then now() else inbox_hidden_at_b end
   where chat_id = v_chat;
  v_again := public.start_listing_chat(v_lamp, null);
  perform pg_temp.assert(v_again <> v_chat, 'a chat hidden by the caller was reused');
  perform pg_temp.assert((select anchor_listing_id from public.chats where chat_id = v_again) = v_lamp,
    'the new chat is not anchored to the listing');

  -- T6: the giver cannot open a chat with themselves from their own listing.
  perform pg_temp.act_as(v_giver);
  begin
    perform public.start_listing_chat(v_shelf, null);
    raise exception 'ASSERT FAILED: the giver opened a chat with themselves';
  exception when sqlstate '22023' then null;
  end;

  -- T7: a suspended account cannot open a listing chat (the opener would bypass the messages RLS).
  update public.users set account_status = 'suspended_admin' where user_id = v_taker;
  perform pg_temp.act_as(v_taker);
  begin
    perform public.start_listing_chat(v_shelf, 'hello');
    raise exception 'ASSERT FAILED: a suspended account opened a listing chat';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'account_not_active' then raise; end if;
  end;

  raise notice '✓ T1-T7 listing chat opens, reuses, re-anchors, honours inbox hide and suspension';
end $$;

rollback;

\echo '✓ 0464_chat_listing_anchor.sql passed'
