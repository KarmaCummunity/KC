-- 0534 — abuse resistance / robustness for direct listing, handoff and follow writes.

begin;

-- Lower the configurable limits for compact boundary checks; transaction rollback
-- restores the seeded defaults (20/30/100 per hour).
update public.marketplace_rule_params set param_value = '2'
 where rule_code in ('R-SEC-Listing-Write', 'R-SEC-Handoff-Write', 'R-SEC-Follow-Write')
   and param_key = 'max_per_hour';

create temp table rate_limit_actors as
select kc_test.create_user('rl_listing') as listing_owner,
       kc_test.create_user('rl_handoff') as handoff_recipient,
       kc_test.create_user('rl_follow') as follower,
       kc_test.create_user('rl_target_1') as target_1,
       kc_test.create_user('rl_target_2') as target_2,
       kc_test.create_user('rl_target_3') as target_3,
       kc_test.create_user('rl_owner_1') as owner_1,
       kc_test.create_user('rl_owner_2') as owner_2,
       kc_test.create_user('rl_owner_3') as owner_3;

do $$
declare
  a rate_limit_actors;
  l1 uuid; l2 uuid; l3 uuid;
begin
  select * into a from rate_limit_actors;

  -- Listings: two writes succeed, third raises the shared established error.
  perform kc_test.create_listing(a.listing_owner, 'items', 'give_item', 'give', 'rl listing 1', '{}'::jsonb);
  perform kc_test.create_listing(a.listing_owner, 'items', 'give_item', 'give', 'rl listing 2', '{}'::jsonb);
  perform kc_test.assert_raises(
    format('select kc_test.create_listing(%L, ''items'', ''give_item'', ''give'', ''rl listing 3'', ''{}''::jsonb)', a.listing_owner),
    'rate_limit_exceeded', 'third listing write is capped');

  -- Handoff request caps are keyed to the recipient making the request.
  l1 := kc_test.create_listing(a.owner_1, 'items', 'give_item', 'give', 'rl handoff 1', '{}'::jsonb);
  l2 := kc_test.create_listing(a.owner_2, 'items', 'give_item', 'give', 'rl handoff 2', '{}'::jsonb);
  l3 := kc_test.create_listing(a.owner_3, 'items', 'give_item', 'give', 'rl handoff 3', '{}'::jsonb);
  perform kc_test.act_as(a.handoff_recipient);
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug)
    values (l1, a.owner_1, a.handoff_recipient, 'items'),
           (l2, a.owner_2, a.handoff_recipient, 'items');
  perform kc_test.assert_raises(
    format('insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug) values (%L, %L, %L, ''items'')', l3, a.owner_3, a.handoff_recipient),
    'rate_limit_exceeded', 'third handoff request is capped');

  -- Follows: two directed edges succeed, third raises the same error.
  perform kc_test.act_as(a.follower);
  insert into public.follow_edges (follower_id, followed_id)
    values (a.follower, a.target_1), (a.follower, a.target_2);
  perform kc_test.assert_raises(
    format('insert into public.follow_edges (follower_id, followed_id) values (%L, %L)', a.follower, a.target_3),
    'rate_limit_exceeded', 'third follow write is capped');
end;
$$;

rollback;

\echo '✓ 0534_write_rate_limits.sql passed'
