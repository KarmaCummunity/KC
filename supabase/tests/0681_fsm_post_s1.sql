-- supabase/tests/0681_fsm_post_s1.sql
-- Wave 1: posts.status follows machine `post` in the FSM catalog (spec 07 §7.1, D104).
-- The full S1 walk and the owner guards stay covered by 0665_g1_one_s1_state_machine.sql.

begin;

do $$
begin
  -- The catalog holds the S1 graph: 7 states, 25 edges, none role-restricted.
  perform kc_test.assert_eq(
    (select count(*) from public.fsm_state where machine_id = 'post'), 7::bigint, 'post has 7 states');
  perform kc_test.assert_eq(
    (select count(*) from public.fsm_edge where machine_id = 'post'), 25::bigint, 'post has 25 edges');
  perform kc_test.assert_eq(
    (select count(*) from public.fsm_edge where machine_id = 'post' and role <> ''), 0::bigint,
    'post edges are not role-restricted yet');

  -- D127: an expired post is never reopened.
  perform kc_test.assert_raises(
    $q$select public.fsm_assert_transition('post', 'expired', 'open', null)$q$,
    'illegal_transition', 'kernel refuses expired -> open');
  perform public.fsm_assert_transition('post', 'paused', 'open', null);
end $$;

do $$
declare
  v_owner uuid := kc_test.create_user('fsm_post_owner');
  v_post uuid;
begin
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug
  ) values (
    v_owner, 'FSM wave 1', 'Description', 'Furniture', 'Give', 'open',
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'items'
  ) returning post_id into v_post;

  -- A legal move passes through the trigger.
  update public.posts set status = 'paused' where post_id = v_post;
  perform kc_test.assert_eq(
    (select status from public.posts where post_id = v_post), 'paused', 'open -> paused');

  -- An illegal move keeps the client-facing code (23514 posts_status_transition_invalid).
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'closed_delivered', v_post),
    'posts_status_transition_invalid', 'paused -> closed_delivered is invalid');

  -- An unknown status is refused by the graph before the column check.
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'bogus', v_post),
    'posts_status_transition_invalid', 'unknown status is invalid');

  -- Expired is not reopened through the table either.
  update public.posts set status = 'expired' where post_id = v_post;
  perform kc_test.assert_raises(
    format('update public.posts set status = %L where post_id = %L', 'open', v_post),
    'posts_status_transition_invalid', 'expired -> open is invalid (republish instead)');
  perform kc_test.assert_eq(
    (select status from public.posts where post_id = v_post), 'expired', 'refused move leaves expired');
end $$;

rollback;

\echo '✓ 0681_fsm_post_s1.sql passed'
