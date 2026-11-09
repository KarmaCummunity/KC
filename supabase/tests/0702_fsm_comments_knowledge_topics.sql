-- supabase/tests/0702_fsm_comments_knowledge_topics.sql
-- Wave 4b (#1989): post comments and knowledge topics follow the kernel machines `post_comment`
-- and `knowledge_topic`. Comments are written only through their RPCs, and approving an active
-- topic keeps its original reviewer. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w4b_author')    as author,
       kc_test.create_user('w4b_other')     as other,
       kc_test.create_user('w4b_moderator') as moderator,
       kc_test.create_user('w4b_second')    as second_moderator;
insert into public.admin_role_grants (user_id, role)
select moderator, 'moderator' from personas
union all select second_moderator, 'moderator' from personas;

create temp table fixture as
select kc_test.create_listing(
  (select author from personas), 'items', 'give_item', 'give', 'Comment lamp',
  '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb) as listing_id;

-- ── 1. A comment is edited and deleted through its RPCs only ───────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_comment public.post_comments;
begin
  select * into p from personas;
  select post_id into v_post from public.posts where owner_id = p.author limit 1;

  perform kc_test.act_as(p.author);
  v_comment := public.rpc_create_post_comment(v_post, 'first');
  v_comment := public.rpc_update_post_comment(v_comment.comment_id, 'edited');
  perform kc_test.assert_eq(v_comment.body, 'edited', 'the author edits through the RPC');

  perform kc_test.act_as(p.other);
  perform kc_test.assert_raises(
    format('select public.rpc_delete_post_comment(%L)', v_comment.comment_id),
    'comment_not_found', 'another member cannot delete the comment');

  perform kc_test.act_as(p.author);
  v_comment := public.rpc_delete_post_comment(v_comment.comment_id);
  perform kc_test.assert_eq(v_comment.status, 'deleted', 'the author deletes it');

  perform kc_test.assert_raises(
    format('update public.post_comments set status = %L where comment_id = %L', 'active', v_comment.comment_id),
    'post_comment_transition_invalid', 'a deleted comment is not restored');
  perform kc_test.assert_true(
    not has_table_privilege('authenticated', 'public.post_comments', 'UPDATE'),
    'clients have no direct UPDATE on post_comments');
end $$;

-- ── 2. Knowledge topics: approve once, merge for good ──────────────────────────
do $$
declare
  p personas;
  v_topic public.knowledge_topics;
  v_target uuid;
begin
  select * into p from personas;
  insert into public.knowledge_topics (slug, label_he, label_en, status, created_by)
  values ('w4b-topic', 'נושא', 'Topic', 'proposed', p.other)
  returning * into v_topic;

  perform kc_test.act_as(p.moderator);
  v_topic := public.review_knowledge_topic(v_topic.topic_id, 'approve');
  perform kc_test.assert_eq(v_topic.approved_by, p.moderator, 'the first approval records the reviewer');

  perform kc_test.act_as(p.second_moderator);
  v_topic := public.review_knowledge_topic(v_topic.topic_id, 'approve');
  perform kc_test.assert_eq(v_topic.approved_by, p.moderator, 'approving an active topic keeps the reviewer');

  perform kc_test.assert_raises(
    format('update public.knowledge_topics set status = %L where topic_id = %L', 'proposed', v_topic.topic_id),
    'knowledge_topic_transition_invalid', 'an active topic is not sent back to proposed');

  select topic_id into v_target from public.knowledge_topics
   where status = 'active' and topic_id <> v_topic.topic_id and parent_id is null limit 1;
  v_topic := public.review_knowledge_topic(v_topic.topic_id, 'merge', v_target);
  perform kc_test.assert_eq(v_topic.status, 'merged', 'the topic is merged');
  perform kc_test.assert_raises(
    format('update public.knowledge_topics set status = %L, merged_into_id = null where topic_id = %L',
           'active', v_topic.topic_id),
    'knowledge_topic_transition_invalid', 'a merge is final');
end $$;

rollback;

\echo '✓ 0702_fsm_comments_knowledge_topics.sql passed'
