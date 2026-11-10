-- Follow requests, the follow RPCs, the privacy mode switch and per-field profile visibility.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a'…'e') or as the signed-out role ('anon'). `@a` in the
-- statement stands for that member's id. Returns the first column of the first row, or the
-- number of rows changed when the statement returns nothing.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'anon' then 'anon' else 'authenticated' end;
  v_sub constant text := case p_who when 'anon' then null else '00000000-0000-4000-8000-00000000000' || p_who end;
  v_out text;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  p_sql := regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  if p_sql ~* '^\s*select|\sreturning\s' then
    execute p_sql into v_out;
  else
    execute p_sql;
  end if;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return coalesce(v_out, v_rows::text);
end;
$$;

create function pg_temp.id(p_who text) returns uuid language sql as
  $$select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid$$;

-- Statuses of the requests from one member to another, sorted by name.
create function pg_temp.requests(p_from text, p_to text) returns text language sql as $$
  select string_agg(status, ',' order by status)
    from public.follow_requests where requester_id = pg_temp.id(p_from) and target_id = pg_temp.id(p_to);
$$;

create function pg_temp.follows(p_from text, p_to text) returns boolean language sql as $$
  select exists (select 1 from public.follows where follower_id = pg_temp.id(p_from) and followed_id = pg_temp.id(p_to));
$$;

select plan(60);

-- Five active members. a is the private profile under test.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.id(w), w || '@example.test', '{"provider":"google"}' from unnest(array['a', 'b', 'c', 'd', 'e']) w;

-- ── Privacy mode ────────────────────────────────────────────────────────────
select throws_ok($$select pg_temp.run('a', 'select public.set_privacy_mode(''Hidden'')')$$,
  'P0001', 'invalid_privacy_mode', 'an unknown privacy mode is rejected');
select lives_ok($$select pg_temp.run('a', 'select public.set_privacy_mode(''Private'')')$$, 'a member makes the profile private');
select is((select privacy_mode || '|' || (privacy_changed_at is not null) from public.users where id = pg_temp.id('a')),
  'Private|true', 'the switch stores the mode and its time');

-- ── follow_user on a public profile ─────────────────────────────────────────
select is(pg_temp.run('b', 'select public.follow_user(@c)'), 'following', 'a public profile is followed at once');
select is(pg_temp.run('b', 'select public.follow_user(@c)'), 'following', 'following again is a no-op');
select is((select followers_count from public.user_stats where user_id = pg_temp.id('c')), 1, 'one edge exists, counted once');
select throws_ok($$select pg_temp.run('b', 'select public.follow_user(@b)')$$,
  'P0001', 'self_follow_forbidden', 'a member cannot follow themselves');
select throws_ok($$select pg_temp.run('anon', 'select public.follow_user(@b)')$$, '42501', null, 'a signed-out caller cannot follow');

-- ── follow_user on a private profile → request ──────────────────────────────
select is(pg_temp.run('b', 'select public.follow_user(@a)'), 'requested', 'a private profile gets a follow request');
select is(pg_temp.run('b', 'select public.follow_user(@a)'), 'requested', 'asking again keeps the one live request');
select is(pg_temp.requests('b', 'a') || '|' || pg_temp.follows('b', 'a'), 'pending|false', 'a pending request is not a follow edge');

select is(pg_temp.run('a', 'select count(*) from public.follow_requests'), '1', 'the target sees the request');
select is(pg_temp.run('b', 'select count(*) from public.follow_requests'), '1', 'the requester sees the request');
select is(pg_temp.run('c', 'select count(*) from public.follow_requests'), '0', 'nobody else sees the request');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.follow_requests')$$, '42501', null, 'a signed-out caller cannot read requests');
select throws_ok($$select pg_temp.run('c', 'insert into public.follow_requests (requester_id, target_id) values (@c, @a)')$$,
  '42501', null, 'a request cannot be inserted from a device');
select throws_ok($$select pg_temp.run('a', 'update public.follow_requests set status = ''accepted''')$$,
  '42501', null, 'a request cannot be moved from a device');

-- ── Machine: unknown state, role-restricted edges, illegal edge ─────────────
select throws_ok($$update public.follow_requests set status = 'expired'$$, 'P0001', 'unknown_state', 'a status outside the machine is rejected');
select throws_ok($$update public.follow_requests set status = 'accepted'$$, 'P0001', 'forbidden_role', 'accepting needs the target role');
set local "kc.fsm_role" = 'requester';
select throws_ok($$update public.follow_requests set status = 'rejected'$$, 'P0001', 'forbidden_role', 'the requester role cannot reject');
set local "kc.fsm_role" = '';
select throws_ok(
  $$insert into public.follow_requests (requester_id, target_id) values (pg_temp.id('b'), pg_temp.id('a'))$$,
  '23505', null, 'a pair has at most one pending request');

-- ── Reject, cooldown, re-request ────────────────────────────────────────────
select throws_ok($$select pg_temp.run('c', 'select public.follow_request_decide(@b, true)')$$,
  'P0001', 'follow_request_not_pending', 'only the target can decide a request');
select throws_ok($$select pg_temp.run('a', 'select public.follow_request_decide(@b, null)')$$,
  'P0001', 'invalid_decision', 'a decision must be yes or no');
select lives_ok($$select pg_temp.run('a', 'select public.follow_request_decide(@b, false)')$$, 'the target rejects the request');
select ok(
  (select status = 'rejected' and resolved_at is not null
      and cooldown_until between now() + interval '14 days' - interval '1 minute' and now() + interval '14 days'
     from public.follow_requests where requester_id = pg_temp.id('b')),
  'a rejection stamps the resolution and a 14-day cooldown');
select is(pg_temp.follows('b', 'a'), false, 'a rejection creates no edge');
select throws_ok($$update public.follow_requests set status = 'pending'$$, 'P0001', 'illegal_transition', 'a resolved request never reopens');
select throws_ok($$select pg_temp.run('b', 'select public.follow_user(@a)')$$,
  'P0001', 'follow_request_cooldown_active', 'a new request is refused during the cooldown');

update public.follow_requests set cooldown_until = now() - interval '1 second' where requester_id = pg_temp.id('b');
select is(pg_temp.run('b', 'select public.follow_user(@a)'), 'requested', 'after the cooldown a new request is created');
select is(pg_temp.requests('b', 'a'), 'pending,rejected', 'the rejected request is kept as history');

-- ── Cancel ──────────────────────────────────────────────────────────────────
select throws_ok($$select pg_temp.run('c', 'select public.follow_request_cancel(@a)')$$,
  'P0001', 'follow_request_not_pending', 'only the requester can cancel');
select lives_ok($$select pg_temp.run('b', 'select public.follow_request_cancel(@a)')$$, 'the requester cancels the request');
select is(
  (select count(*) from public.follow_requests where status = 'cancelled' and cooldown_until is null and resolved_at is not null),
  1::bigint, 'a cancellation has no cooldown');
select is(pg_temp.run('b', 'select public.follow_user(@a)'), 'requested', 'the requester may ask again right after cancelling');

-- ── Accept ──────────────────────────────────────────────────────────────────
select lives_ok($$select pg_temp.run('a', 'select public.follow_request_decide(@b, true)')$$, 'the target accepts the request');
select is(pg_temp.requests('b', 'a') || '|' || pg_temp.follows('b', 'a'), 'accepted,cancelled,rejected|true',
  'an accepted request becomes a follow edge');
select is((select followers_count from public.user_stats where user_id = pg_temp.id('a')), 1, 'the accepted follower is counted');
select throws_ok($$select pg_temp.run('a', 'select public.follow_request_decide(@b, true)')$$,
  'P0001', 'follow_request_not_pending', 'a request is decided once');
select is(pg_temp.run('b', 'select public.follow_user(@a)'), 'following', 'an existing follower gets no new request');

-- ── Per-field profile visibility: owner a · follower b · stranger d · blocked e ──
select lives_ok($$select pg_temp.run('a', 'insert into public.user_profile_fields (user_id, field_key, visibility, tags, affiliated_org_id) values
    (@a, ''interests'', null, array[''items'', ''food:bread''], null),
    (@a, ''help_tags'', ''everyone'', array[''rides''], null),
    (@a, ''affiliated_org'', ''only_me'', null, gen_random_uuid())')$$, 'a member fills in the optional fields');
select is((select visibility from public.user_profile_fields where user_id = pg_temp.id('a') and field_key = 'interests'),
  'followers', 'on a private profile the default visibility is followers');
select lives_ok($$select pg_temp.run('c', 'insert into public.user_profile_fields (user_id, field_key, tags) values (@c, ''interests'', array[''items''])')$$,
  'a member with a public profile fills in a field');
select is((select visibility from public.user_profile_fields where user_id = pg_temp.id('c')),
  'everyone', 'on a public profile the default visibility is everyone');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.id('a'), pg_temp.id('e'));

select is(pg_temp.run('a', 'select string_agg(field_key, '','' order by field_key) from public.user_profile_fields where user_id = @a'),
  'affiliated_org,help_tags,interests', 'the owner reads every field');
select is(pg_temp.run('b', 'select string_agg(field_key, '','' order by field_key) from public.user_profile_fields where user_id = @a'),
  'help_tags,interests', 'a follower reads everyone and followers fields');
select is(pg_temp.run('d', 'select string_agg(field_key, '','' order by field_key) from public.user_profile_fields where user_id = @a'),
  'help_tags', 'a stranger reads only everyone fields');
select is(pg_temp.run('e', 'select count(*) from public.user_profile_fields where user_id = @a'),
  '0', 'a blocked member reads nothing');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.user_profile_fields')$$, '42501', null, 'a signed-out caller reads nothing');
select is(pg_temp.run('b', $$update public.user_profile_fields set visibility = 'everyone' where user_id = @a$$),
  '0', 'another member cannot change a field');
select throws_ok($$select pg_temp.run('b', 'insert into public.user_profile_fields (user_id, field_key, tags) values (@a, ''help_tags'', array[''x''])')$$,
  '42501', null, 'a field cannot be written for another member');
select throws_ok($$select pg_temp.run('b', 'insert into public.user_profile_fields (user_id, field_key, tags) values (@b, ''help_tags'', array[''Not A Slug''])')$$,
  '23514', null, 'tags must be slugs');
select throws_ok($$select pg_temp.run('b', 'insert into public.user_profile_fields (user_id, field_key, tags) values (@b, ''affiliated_org'', array[''x''])')$$,
  '23514', null, 'each field holds its own kind of value');

-- ── Blocks and unavailable members ──────────────────────────────────────────
delete from public.blocks;
select is(pg_temp.run('e', 'select public.follow_user(@a)'), 'requested', 'e asks to follow a');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.id('a'), pg_temp.id('e'));
select is(pg_temp.requests('e', 'a'), 'cancelled', 'a block withdraws the pending request');
select throws_ok($$select pg_temp.run('e', 'select public.follow_user(@a)')$$,
  'P0001', 'blocked_relationship', 'a blocked pair cannot follow each other');
delete from public.blocks;

update public.user_account set status = 'suspended_admin' where user_id = pg_temp.id('c');
select throws_ok($$select pg_temp.run('d', 'select public.follow_user(@c)')$$,
  'P0001', 'user_unavailable', 'an inactive member cannot be followed');
select throws_ok($$select pg_temp.run('c', 'select public.follow_user(@d)')$$,
  'P0001', 'account_not_active', 'an inactive member cannot follow');
select is(pg_temp.run('d', 'select count(*) from public.user_profile_fields where user_id = @c'),
  '0', 'fields of an inactive member are hidden');

-- ── Going public accepts every pending request (FR-PROFILE-006 AC2) ─────────
select pg_temp.run('d', 'select public.follow_user(@a)') || pg_temp.run('e', 'select public.follow_user(@a)') as two_requests \gset
select pg_temp.run('a', $$select public.set_privacy_mode('Public')$$) as went_public \gset
select is(
  :'two_requests' || '|' || pg_temp.follows('d', 'a') || '|' || pg_temp.follows('e', 'a')
    || '|' || (select count(*) from public.follow_requests where status = 'pending'),
  'requestedrequested|true|true|0', 'going public turns every pending request into a follow edge');

-- ── Account removal ─────────────────────────────────────────────────────────
delete from auth.users where id = pg_temp.id('a');
select is(
  (select count(*) from public.follow_requests) + (select count(*) from public.user_profile_fields where user_id = pg_temp.id('a')),
  0::bigint, 'removing an account removes its requests and profile fields');

select * from finish();
rollback;
