-- Opening a challenge publishes a post the challenges-world feed can show (0639).

begin;

create temp table personas as
select kc_test.create_user('chal_post_creator') as creator;

do $$
declare
  p personas;
  v_id uuid;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.creator);

  v_id := public.create_challenge(
    'Read daily', 'community', 'yes_no', 'daily', p_description => 'A community challenge');
  select post_id into v_post from public.challenges where challenge_id = v_id;

  perform kc_test.assert_true(v_post is not null, 'opening a challenge creates a post');
  perform kc_test.assert_eq((select post_type from public.posts where post_id = v_post), 'challenge',
    'the post is a challenge');
  perform kc_test.assert_eq((select world_slug from public.posts where post_id = v_post), 'challenges',
    'the post belongs to the challenges world');
  perform kc_test.assert_eq((select listing_world_slug from public.posts where post_id = v_post), 'challenges',
    'the feed files the post under challenges');
  perform kc_test.assert_eq((select visibility from public.posts where post_id = v_post), 'Public',
    'a community challenge is a public post');
  perform kc_test.assert_eq((select details->>'challenge_id' from public.posts where post_id = v_post), v_id::text,
    'the post points back at the challenge');
  perform kc_test.assert_eq(
    (select count(*)::int from public.karma_ledger where user_id = p.creator and event_type = 'post_created'),
    0, 'a challenge post does not also earn the generic post-created karma');

  v_id := public.create_challenge('Private habit', 'personal', 'yes_no', 'daily');
  perform kc_test.assert_eq(
    (select p2.visibility from public.posts p2
       join public.challenges c on c.post_id = p2.post_id
      where c.challenge_id = v_id),
    'OnlyMe', 'a personal challenge is a private post');

  perform public.end_challenge(v_id);
  perform kc_test.assert_eq(
    (select p2.status from public.posts p2
       join public.challenges c on c.post_id = p2.post_id
      where c.challenge_id = v_id),
    'paused', 'ending a challenge takes its post out of the open feed');
end $$;

commit;
