-- supabase/tests/0544_block_filtering_both_ways.sql | 0544 (FR-MOD-009 AC1 / AC3): once one member
-- of a pair blocks the other, the two never see or reach each other, in both directions:
-- their chat, messages, profile rows through the chat, new chats, comments and reactions,
-- food claims, the closure recipient and notifications. The reads and writes that RLS guards
-- run as `authenticated`, so the policies apply as for a signed-in member.

begin;

create temp table personas as
select kc_test.create_user('block_blocker') as blocker,
       kc_test.create_user('block_blocked') as blocked,
       kc_test.create_user('block_third') as third;
grant select on personas to authenticated;

-- The count a statement returns for a member, with RLS enforced.
create function pg_temp.count_as(p_user uuid, p_sql text)
returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from (%s) q', p_sql) into v_count;
  reset role;
  return v_count;
end $$;

-- Runs one write as a member with RLS enforced; returns the error text, or null on success.
create function pg_temp.try_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v_error text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  reset role;
  return v_error;
end $$;

-- ── fixtures, created before the block ──────────────────────────────────────
create temp table fx (chat_id uuid, third_post uuid, own_post uuid, food uuid);
grant select on fx to authenticated;

do $$
declare
  p personas;
  v_chat uuid;
  v_third_post uuid;
  v_own_post uuid;
begin
  select * into p from personas;
  insert into public.chats (participant_a, participant_b)
  values (least(p.blocker, p.blocked), greatest(p.blocker, p.blocked))
  returning chat_id into v_chat;
  insert into public.messages (chat_id, sender_id, kind, body, status)
  values (v_chat, p.blocked, 'user', 'hello', 'pending');

  -- A third member's post, with a comment and a like by the member who will be blocked.
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.third, 'Give', 'Third party lamp', 'Books', 'tel-aviv', 'Herzl', '1')
  returning post_id into v_third_post;
  insert into public.post_comments (post_id, author_id, body) values (v_third_post, p.blocked, 'nice');
  insert into public.post_reactions (post_id, user_id, reaction_type) values (v_third_post, p.blocked, 'like');

  -- The blocker's own open post, for the closure recipient case.
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.blocker, 'Give', 'Blocker chair', 'Books', 'tel-aviv', 'Herzl', '2')
  returning post_id into v_own_post;

  insert into fx values (v_chat, v_third_post, v_own_post,
    kc_test.create_listing(p.blocker, 'food', 'give_food', 'give', 'Blocker soup',
      jsonb_build_object('food_type', 'cooked', 'expires_at', kc_test.iso_in(interval '6 hours'),
                         'allergens', jsonb_build_array('gluten')),
      now() + interval '6 hours'));

  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocked, format('select 1 from public.chats where chat_id = %L', v_chat)), 1::bigint,
    'before the block, both members see their chat');
end $$;

insert into public.blocks (blocker_id, blocked_id) select blocker, blocked from personas;

-- ── chats and messages: hidden from both, closed to both ────────────────────
do $$
declare
  p personas;
  f fx;
begin
  select * into p from personas;
  select * into f from fx;
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocker, format('select 1 from public.chats where chat_id = %L', f.chat_id)), 0::bigint,
    'the blocker no longer sees the chat');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocked, format('select 1 from public.chats where chat_id = %L', f.chat_id)), 0::bigint,
    'the blocked member no longer sees the chat either');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocked, format('select 1 from public.messages where chat_id = %L', f.chat_id)), 0::bigint,
    'nor its messages');
  perform kc_test.assert_true(
    pg_temp.try_as(p.blocked, format(
      'insert into public.messages (chat_id, sender_id, kind, body, status) values (%L, %L, %L, %L, %L)',
      f.chat_id, p.blocked, 'user', 'again', 'pending')) is not null,
    'the blocked member cannot send');
  perform kc_test.assert_true(
    pg_temp.try_as(p.blocker, format(
      'insert into public.messages (chat_id, sender_id, kind, body, status) values (%L, %L, %L, %L, %L)',
      f.chat_id, p.blocker, 'user', 'hi', 'pending')) is not null,
    'nor can the blocker');
  -- A second chat for the pair is refused (the canonical pair is checked before uniqueness).
  delete from public.chats where chat_id = f.chat_id;
  perform kc_test.assert_true(
    pg_temp.try_as(p.blocked, format(
      'insert into public.chats (participant_a, participant_b) values (%L, %L)',
      least(p.blocker, p.blocked), greatest(p.blocker, p.blocked))) is not null,
    'no new chat between a blocked pair');
end $$;

-- ── profile rows, comments, reactions ───────────────────────────────────────
do $$
declare
  p personas;
  f fx;
begin
  select * into p from personas;
  select * into f from fx;
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocked, format('select 1 from public.users where user_id = %L', p.blocker)), 0::bigint,
    'the blocked member cannot read the blocker''s profile row');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocker, format('select 1 from public.post_comments where post_id = %L', f.third_post)), 0::bigint,
    'the blocker does not see the blocked member''s comment on a third party''s post');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.blocker, format('select 1 from public.post_reactions where post_id = %L', f.third_post)), 0::bigint,
    'nor their reaction');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.third, format('select 1 from public.post_comments where post_id = %L', f.third_post)), 1::bigint,
    'the post''s owner still sees the comment');
  perform kc_test.assert_eq(
    pg_temp.count_as(p.third, format('select 1 from public.post_reactions where post_id = %L', f.third_post)), 1::bigint,
    'and the reaction');
end $$;

-- ── food claim, closure recipient, notifications ────────────────────────────
do $$
declare
  p personas;
  f fx;
begin
  select * into p from personas;
  select * into f from fx;
  perform kc_test.act_as(p.blocked);
  perform kc_test.assert_raises(format('select public.claim_food_giving(%L)', f.food),
    'listing_not_available', 'the blocked member cannot claim the blocker''s food');
  perform kc_test.act_as(p.third);
  perform kc_test.assert_eq((public.claim_food_giving(f.food)).status, 'confirmed',
    'another member still can');

  perform kc_test.act_as(p.blocker);
  perform kc_test.assert_raises(format('select public.close_post_with_recipient(%L, %L)', f.own_post, p.blocked),
    'closure_recipient_not_in_chat', 'the blocked member cannot be picked as recipient');

  perform kc_test.act_as(p.blocked);
  perform kc_test.assert_true(
    public.enqueue_notification(p.blocker, 'social', 'comment_mention', 't', 'b') is null,
    'an action by the blocked member does not notify the blocker');
  perform kc_test.act_as(p.blocker);
  perform kc_test.assert_true(
    public.enqueue_notification(p.blocked, 'social', 'comment_mention', 't', 'b') is null,
    'nor the other way round');
  perform kc_test.assert_true(
    public.enqueue_notification(p.blocked, 'critical', 'account_notice', 't', 'b', p_bypass_preferences => true) is not null,
    'a notice that bypasses preferences still arrives');
  perform kc_test.act_as(p.third);
  perform kc_test.assert_true(
    public.enqueue_notification(p.blocker, 'social', 'comment_mention', 't', 'b') is not null,
    'a third member still notifies the blocker');
end $$;

rollback;

\echo '✓ 0544_block_filtering_both_ways.sql passed'
