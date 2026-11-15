-- supabase/tests/0261_match_alerts.sql | Issue #830

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

do $$
declare
  v_sub uuid := '00000000-0000-0000-0000-000000261001';
  v_owner uuid := '00000000-0000-0000-0000-000000261002';
  v_before int;
  v_after int;
begin
  perform pg_temp.mk_user(v_sub, 'sub_user');
  perform pg_temp.mk_user(v_owner, 'lst_owner');

  insert into public.match_alert_subscriptions (user_id, world_slug, direction, saved_query)
  values (v_sub, 'items', 'give', 'stroller');

  select count(*) into v_before from public.notifications_outbox where user_id = v_sub;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, details
  )
  select v_owner, 'items', kind_id, 'give', 'Compact stroller fold', 'native', 'published', now(),
         '{"image_url":"https://example.test/fold.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item';

  select count(*) into v_after from public.notifications_outbox where user_id = v_sub;
  if v_after <= v_before then
    raise exception 'ASSERT FAILED: subscription should enqueue a notification';
  end if;
end $$;

do $$
declare
  v_a uuid := '00000000-0000-0000-0000-000000261003';
  v_b uuid := '00000000-0000-0000-0000-000000261004';
  v_give uuid;
  v_req uuid;
  v_mid uuid;
  v_cnt int;
begin
  perform pg_temp.mk_user(v_a, 'own_a');
  perform pg_temp.mk_user(v_b, 'own_b');

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, details
  )
  select v_a, 'items', kind_id, 'give', 'Give lamp', 'native', 'published', now(),
         '{"image_url":"https://example.test/lamp.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_give;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, details
  )
  select v_b, 'items', kind_id, 'request', 'Need lamp', 'native', 'published', now(),
         '{"image_url":"https://example.test/need-lamp.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'request_item'
  returning listing_id into v_req;

  v_mid := least(v_give, v_req);
  insert into public.listing_matches (listing_id, candidate_listing_id, score, status)
  values (least(v_give, v_req), greatest(v_give, v_req), 0.8, 'suggested');

  select count(*) into v_cnt
    from public.notifications_outbox
   where kind = 'listing_match_found'
     and user_id in (v_a, v_b);
  if v_cnt < 2 then
    raise exception 'ASSERT FAILED: listing_matches trigger should notify both owners';
  end if;
end $$;

rollback;

\echo '✓ 0261_match_alerts.sql passed'
