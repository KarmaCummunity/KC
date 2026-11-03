-- 0452 — D33 / D61 (docs/spec/07_cross_cutting_systems.md §7.15), G33 / G20:
-- 3 reports hide a post for review (not remove); 5 reporters in 30 days
-- suspend a user; a suspended user can still chat with support.

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
  update public.users set share_handle = p_handle, account_status = 'active', privacy_mode = 'Public'
   where user_id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.report(p_reporter uuid, p_type text, p_target uuid)
returns void language sql as $$
  insert into public.reports (reporter_id, target_type, target_id, reason) values (p_reporter, p_type, p_target, 'Spam');
$$;

do $$
declare
  v_admin uuid := (select user_id from public.users where is_super_admin limit 1);
  v_owner uuid := pg_temp.mk_user('h452_owner');
  v_viewer uuid := pg_temp.mk_user('h452_viewer');
  v_r uuid[] := array[pg_temp.mk_user('h452_r1'), pg_temp.mk_user('h452_r2'), pg_temp.mk_user('h452_r3'),
                      pg_temp.mk_user('h452_r4'), pg_temp.mk_user('h452_r5')];
  v_post uuid;
  v_karma_before int;
  v_post_row public.posts;
begin
  if v_admin is null then
    v_admin := pg_temp.mk_user('h452_admin');
    update public.users set is_super_admin = true where user_id = v_admin;
  end if;

  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number)
  values (gen_random_uuid(), v_owner, 'Give', 'Reported sofa', 'd',
          (select city_id from public.cities limit 1), 'St', '1')
  returning post_id into v_post;
  select karma_points into v_karma_before from public.users where user_id = v_owner;

  -- T1: two reports change nothing, the third hides the post for review.
  perform pg_temp.report(v_r[1], 'post', v_post);
  perform pg_temp.report(v_r[2], 'post', v_post);
  perform pg_temp.assert((select status from public.posts where post_id = v_post) = 'open', 'hidden after 2 reports');
  perform pg_temp.report(v_r[3], 'post', v_post);
  select * into v_post_row from public.posts where post_id = v_post;
  perform pg_temp.assert(v_post_row.status = 'hidden_pending_review', '3 reports did not hide the post for review');

  -- T2: hidden from others, still visible to its owner; no karma taken while pending.
  perform pg_temp.assert(not public.is_post_visible_to(v_post_row, v_viewer), 'hidden post visible to another user');
  perform pg_temp.assert(public.is_post_visible_to(v_post_row, v_owner), 'owner cannot see own hidden post');
  perform pg_temp.assert((select karma_points from public.users where user_id = v_owner) = v_karma_before,
    'karma changed while the post is only hidden');

  -- T3: the owner is told the post is hidden for review (support-thread bubble).
  perform pg_temp.assert(exists (
    select 1 from public.messages m join public.chats c on c.chat_id = m.chat_id
     where c.is_support_thread and v_owner in (c.participant_a, c.participant_b)
       and m.system_payload ->> 'kind' = 'owner_auto_removed'
       and m.system_payload ->> 'outcome' = 'hidden_pending_review'), 'owner got no hidden-for-review bubble');

  -- T4: admin restore brings it back to open; admin search lists the status.
  perform pg_temp.act_as(v_admin);
  perform public.admin_restore_target('post', v_post);
  perform pg_temp.assert((select status from public.posts where post_id = v_post) = 'open', 'admin restore did not reopen');

  -- T5: admin removal of a hidden post remembers it was open.
  update public.posts set status = 'hidden_pending_review' where post_id = v_post;
  perform public.admin_remove_post(v_post);
  perform pg_temp.assert((select status_before_admin_removal from public.posts where post_id = v_post) = 'open',
    'removed hidden post did not record open as its previous status');
  perform pg_temp.assert(
    (select count(*) from public.admin_search_posts(p_status => 'hidden_pending_review')) >= 0,
    'admin search rejects the new status');
  raise notice '✓ T1-T5 post hidden for review, restore, remove, search';
end $$;

-- T6: a user needs 5 distinct reporters (30 days) to be suspended, not 3.
do $$
declare
  v_target uuid := pg_temp.mk_user('h452_target');
  i int;
begin
  perform set_config('request.jwt.claims', '', true); -- back to the trusted (cron/admin SQL) context
  for i in 1..4 loop
    perform pg_temp.report(pg_temp.mk_user('h452_ur' || i), 'user', v_target);
  end loop;
  perform pg_temp.assert((select account_status from public.users where user_id = v_target) = 'active',
    'user suspended before 5 distinct reporters');
  perform pg_temp.report(pg_temp.mk_user('h452_ur5'), 'user', v_target);
  perform pg_temp.assert((select account_status from public.users where user_id = v_target) = 'suspended_admin',
    '5 distinct reporters did not suspend the user');
  raise notice '✓ T6 user suspension at 5 reporters';
end $$;

-- T7: a suspended user may write to support, but not to an ordinary chat.
do $$
declare
  v_s uuid := pg_temp.mk_user('h452_suspended');
  v_other uuid := pg_temp.mk_user('h452_peer');
  v_support uuid;
  v_chat uuid;
begin
  update public.users set account_status = 'suspended_admin' where user_id = v_s;
  v_support := public.find_or_create_support_chat(v_s);
  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (least(v_s, v_other), greatest(v_s, v_other), false) returning chat_id into v_chat;

  perform pg_temp.act_as(v_s);
  set local role authenticated;
  insert into public.messages (chat_id, sender_id, kind, body, status)
  values (v_support, v_s, 'user', 'Please review my account', 'pending');
  begin
    insert into public.messages (chat_id, sender_id, kind, body, status)
    values (v_chat, v_s, 'user', 'hi', 'pending');
    raise exception 'ASSERT FAILED: suspended user wrote to an ordinary chat';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice '✓ T7 suspended user reaches support only';
end $$;

rollback;

\echo '✓ 0452_hide_reported_posts_for_review.sql passed'
