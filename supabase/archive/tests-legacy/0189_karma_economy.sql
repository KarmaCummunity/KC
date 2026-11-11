-- 0189_karma_economy | FR-KARMA-001..006 — comprehensive karma trigger economy test.
-- Exercises every scored event end-to-end against the real triggers (0189) +
-- helpers (0188): registration, post-create, Give & Request closure (both economic
-- roles + value bonus), reopen & un-mark reversal, follow churn, outreach
-- (once-per-post, owner-exempt, soft daily cap), admin-remove, floor-at-zero, and
-- the karma_points == greatest(0, sum(ledger)) invariant.
-- Runs on the ephemeral CI stack (no rollback needed); on shared dev wrap in
-- BEGIN...ROLLBACK.

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle, account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.k(p uuid) returns int language sql as $$
  select karma_points from public.users where user_id = p $$;

create or replace function pg_temp.eq(p_actual int, p_expected int, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT FAILED [%]: got %, want %', p_label, p_actual, p_expected;
  end if;
end $$;

-- Asserts karma_points equals the floored ledger sum for a user (denorm integrity).
create or replace function pg_temp.assert_ledger_consistent(p uuid, p_label text)
returns void language plpgsql as $$
declare v_sum int; v_denorm int;
begin
  select greatest(0, coalesce(sum(points_delta), 0)) into v_sum from public.karma_ledger where user_id = p;
  select karma_points into v_denorm from public.users where user_id = p;
  if v_denorm is distinct from v_sum then
    raise exception 'LEDGER DRIFT [%]: denorm %, greatest(0,sum(ledger)) %', p_label, v_denorm, v_sum;
  end if;
end $$;

do $$
declare
  a uuid := pg_temp.mk_user('ka_' || substr(gen_random_uuid()::text,1,8));
  b uuid := pg_temp.mk_user('kb_' || substr(gen_random_uuid()::text,1,8));
  give_post uuid; req_post uuid; rm_post uuid; cap_post uuid;
  chat uuid; cap_chat uuid;
  v_city text := (select city_id::text from public.cities limit 1);  -- valid FK on dev + CI seed
begin
  if v_city is null then raise exception 'no city seeded — cannot run karma economy test'; end if;

  -- 1. registration: every new user starts at +1
  perform pg_temp.eq(pg_temp.k(a), 1, 'registration A');
  perform pg_temp.eq(pg_temp.k(b), 1, 'registration B');

  -- 2. post_created: A publishes a Give post (value 500) → +5
  insert into public.posts (owner_id, type, title, status, visibility, city, street, street_number, location_display_level, category, estimated_value)
  values (a,'Give','give1','open','Public',v_city,'Test','1','CityOnly','Other',500) returning post_id into give_post;
  perform pg_temp.eq(pg_temp.k(a), 6, 'post_created A=6');

  -- 3. closure (Give): mark B + status→closed_delivered → giver A +20+bonus(500=10), receiver B +15
  insert into public.recipients (post_id, recipient_user_id) values (give_post, b);
  update public.posts set status='closed_delivered' where post_id=give_post;
  perform pg_temp.eq(pg_temp.k(a), 36, 'Give closure giver A=36');
  perform pg_temp.eq(pg_temp.k(b), 16, 'Give closure receiver B=16');

  -- 4. reopen reversal: status→open → both revert
  update public.posts set status='open' where post_id=give_post;
  perform pg_temp.eq(pg_temp.k(a), 6, 'reopen giver A=6');
  perform pg_temp.eq(pg_temp.k(b), 1, 'reopen receiver B=1');

  -- 5. closure (Request): roles flip — recipient is the giver, owner is the receiver, no value bonus
  insert into public.posts (owner_id, type, title, status, visibility, city, street, street_number, location_display_level, category)
  values (a,'Request','req1','open','Public',v_city,'Test','1','CityOnly','Other') returning post_id into req_post;
  perform pg_temp.eq(pg_temp.k(a), 11, 'Request post A=11');
  insert into public.recipients (post_id, recipient_user_id) values (req_post, b);
  update public.posts set status='closed_delivered' where post_id=req_post;
  perform pg_temp.eq(pg_temp.k(b), 21, 'Request closure giver B=21');
  perform pg_temp.eq(pg_temp.k(a), 26, 'Request closure receiver A=26');

  -- 6. un-mark reversal (leaving closed_delivered → deleted_no_recipient) → both revert
  update public.posts set status='deleted_no_recipient' where post_id=req_post;
  perform pg_temp.eq(pg_temp.k(b), 1, 'unmark giver B=1');
  perform pg_temp.eq(pg_temp.k(a), 11, 'unmark receiver A=11');

  -- 7. follower churn: B follows A → A +1; unfollow → A -1 (net zero)
  insert into public.follow_edges (follower_id, followed_id) values (b, a);
  perform pg_temp.eq(pg_temp.k(a), 12, 'follow A=12');
  delete from public.follow_edges where follower_id=b and followed_id=a;
  perform pg_temp.eq(pg_temp.k(a), 11, 'unfollow A=11');

  -- 8. outreach: chat anchored to A's open post, B messages → B +1; second msg → no extra; owner msg → none
  insert into public.chats (participant_a, participant_b, anchor_post_id) values (a, b, give_post) returning chat_id into chat;
  insert into public.messages (chat_id, sender_id, body) values (chat, b, 'hi');
  perform pg_temp.eq(pg_temp.k(b), 2, 'outreach B=2');
  insert into public.messages (chat_id, sender_id, body) values (chat, b, 'hi again');
  perform pg_temp.eq(pg_temp.k(b), 2, 'outreach once-per-post B=2');
  insert into public.messages (chat_id, sender_id, body) values (chat, a, 'owner reply');
  perform pg_temp.eq(pg_temp.k(a), 11, 'owner outreach exempt A=11');

  -- 9. outreach soft daily cap: B has 1 real outreach today; seed 9 more = 10; next is capped
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
    select b, 'outreach', 1, 'post', 'cap-seed-'||g from generate_series(1,9) g;
  update public.users set karma_points = karma_points + 9 where user_id = b;  -- keep denorm = ledger
  perform pg_temp.eq(pg_temp.k(b), 11, 'cap seed B=11');
  insert into public.posts (owner_id, type, title, status, visibility, city, street, street_number, location_display_level, category)
  values (a,'Give','cap1','open','Public',v_city,'Test','1','CityOnly','Other') returning post_id into cap_post;
  insert into public.chats (participant_a, participant_b, anchor_post_id) values (a, b, cap_post) returning chat_id into cap_chat;
  insert into public.messages (chat_id, sender_id, body) values (cap_chat, b, 'capped?');
  perform pg_temp.eq(pg_temp.k(b), 11, 'outreach daily cap blocks 11th B=11');

  -- 10. admin-remove: A publishes (+5) then status→removed_admin (−5), net zero.
  -- A baseline entering this step = 16 (11 after step 8, + 5 for cap_post inserted in step 9).
  insert into public.posts (owner_id, type, title, status, visibility, city, street, street_number, location_display_level, category)
  values (a,'Give','rm1','open','Public',v_city,'Test','1','CityOnly','Other') returning post_id into rm_post;
  perform pg_temp.eq(pg_temp.k(a), 21, 'pre-remove A=21 (rm_post +5)');
  update public.posts set status='removed_admin' where post_id=rm_post;
  perform pg_temp.eq(pg_temp.k(a), 16, 'admin-remove reverses creation A=16');

  -- 11. ledger integrity for both users (denorm == greatest(0, sum(ledger)))
  perform pg_temp.assert_ledger_consistent(a, 'A pre-floor');
  perform pg_temp.assert_ledger_consistent(b, 'B pre-floor');

  -- 12. floor at zero: a large reversal cannot push karma below 0
  perform public.karma_apply(b, 'closure_reverse', 'post', 'floor-test', -1000);
  perform pg_temp.eq(pg_temp.k(b), 0, 'floor at zero B=0');
  perform pg_temp.assert_ledger_consistent(b, 'B post-floor (greatest(0,sum) holds)');

  raise notice '✓ karma economy: registration, post, Give+Request closure, reopen/unmark reversal, follow churn, outreach (once+owner-exempt+daily cap), admin-remove, floor-at-zero, ledger integrity — all pass';
end $$;
