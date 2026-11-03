-- supabase/tests/0521_chat_media_private.sql
-- Regression for migration 0521 (#1064): chat images are readable only by people who
-- can see the chat.
--
--   1. The `chat-media` bucket is not public.
--   2. Both participants read the chat's images, in the current and the pre-0440 path
--      layout; an outsider reads none of them, nor any other user's image.
--   3. A participant who blocked the other stops reading the chat's images (the
--      predicate that hides the chat's messages), but still reads their own uploads.
--   4. A malformed path never errors and grants nothing.
--
-- Reads run under `set local role authenticated` as plain SELECTs whose counts go to psql
-- variables; assertions run back as postgres (the local image cannot take a denied
-- function call under a switched role, see TECH_DEBT). Runs in a rolled-back transaction.

begin;

select kc_test.assert_eq(
  (select public from storage.buckets where id = 'chat-media'), false,
  'chat-media bucket must not be public');

select kc_test.create_user('cm_alice') as alice,
       kc_test.create_user('cm_bob')   as bob,
       kc_test.create_user('cm_eve')   as eve \gset

insert into public.chats (participant_a, participant_b)
values (least(:'alice'::uuid, :'bob'::uuid), greatest(:'alice'::uuid, :'bob'::uuid))
returning chat_id as chat \gset

insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', :'alice' || '/' || :'chat' || '/a1.jpg', :'alice'),   -- current layout
  ('chat-media', :'bob'   || '/' || :'chat' || '/b1.jpg', :'bob'),
  ('chat-media', :'chat'  || '/' || :'alice' || '/a0.jpg', :'alice'),  -- pre-0440 layout
  ('chat-media', :'eve'   || '/not-a-uuid/e1.jpg', :'eve'),             -- malformed folder
  ('post-images', :'alice' || '/batch/p1.jpg', :'alice');               -- other bucket

-- Counts the chat-media objects the given user may read, into psql variable :seen.
\set count_visible 'select count(*) as seen from storage.objects where bucket_id = ''chat-media'''

select set_config('request.jwt.claims', jsonb_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;
:count_visible \gset alice_
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', :'bob', 'role', 'authenticated')::text, true);
set local role authenticated;
:count_visible \gset bob_
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', :'eve', 'role', 'authenticated')::text, true);
set local role authenticated;
:count_visible \gset eve_
reset role;

select kc_test.assert_eq(:alice_seen::int, 3, 'alice reads the chat''s three images');
select kc_test.assert_eq(:bob_seen::int, 3, 'bob reads the chat''s three images, including alice''s');
select kc_test.assert_eq(:eve_seen::int, 1, 'eve reads only her own upload, none of the chat''s');

-- Bob blocks alice: the chat (and so its images) is hidden from bob; his own upload stays readable.
insert into public.blocks (blocker_id, blocked_id) values (:'bob', :'alice');

select set_config('request.jwt.claims', jsonb_build_object('sub', :'bob', 'role', 'authenticated')::text, true);
set local role authenticated;
:count_visible \gset blocked_
reset role;

select kc_test.assert_eq(:blocked_seen::int, 1, 'bob, having blocked alice, reads only his own upload');

select kc_test.assert_eq(
  public.chat_media_path_chat_ids('no-slash'), array[null]::uuid[],
  'a path without folders yields no chat id');

rollback;

\echo '✓ 0521 chat-media private bucket regression test passed'
