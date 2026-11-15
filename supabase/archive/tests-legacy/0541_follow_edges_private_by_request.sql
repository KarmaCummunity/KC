-- 0541 | A member follows a Public profile directly; a Private profile only through an
-- approved follow request (FR-FOLLOW-003 AC4, FR-FOLLOW-005 AC1, FR-FOLLOW-012 AC2).
-- Unlike most harness tests this one runs the writes as `authenticated`, so RLS applies
-- exactly as for a signed-in member.

begin;

create temp table personas as
select kc_test.create_user('follow_public') as public_target,
       kc_test.create_user('follow_private') as private_target,
       kc_test.create_user('follow_switching') as switching_target,
       kc_test.create_user('follow_member') as member;
update public.users set privacy_mode = 'Private'
 where user_id in (select private_target from personas union all select switching_target from personas);
grant select on personas to authenticated;

-- Runs one statement as the given member with RLS enforced; returns the error text or null.
create function pg_temp.as_member(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare
  v_error text;
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

do $$
declare
  p personas;
begin
  select * into p from personas;

  perform kc_test.assert_eq(pg_temp.as_member(p.member, format(
    'insert into public.follow_edges (follower_id, followed_id) values (%L, %L)', p.member, p.public_target)),
    null, 'a member follows a Public profile directly');
  perform kc_test.assert_true(public.is_following(p.member, p.public_target), 'the Public follow edge exists');

  perform kc_test.assert_true(pg_temp.as_member(p.member, format(
    'insert into public.follow_edges (follower_id, followed_id) values (%L, %L)', p.member, p.private_target))
    like 'new row violates row-level security policy%', 'a direct follow of a Private profile is refused');
  perform kc_test.assert_true(not public.is_following(p.member, p.private_target), 'no edge to the Private profile');

  -- The approved request is the way in (FR-FOLLOW-005 AC1).
  perform kc_test.assert_eq(pg_temp.as_member(p.member, format(
    'insert into public.follow_requests (requester_id, target_id, status) values (%L, %L, %L)',
    p.member, p.private_target, 'pending')), null, 'a member requests to follow a Private profile');
  perform kc_test.assert_eq(pg_temp.as_member(p.private_target, format(
    'update public.follow_requests set status = %L where requester_id = %L and target_id = %L and status = %L',
    'accepted', p.member, p.private_target, 'pending')), null, 'the Private profile approves the request');
  perform kc_test.assert_true(public.is_following(p.member, p.private_target), 'approval creates the follow edge');

  -- Going Public accepts pending requests through the privacy trigger (users_on_privacy_mode_change).
  perform kc_test.assert_eq(pg_temp.as_member(p.member, format(
    'insert into public.follow_requests (requester_id, target_id, status) values (%L, %L, %L)',
    p.member, p.switching_target, 'pending')), null, 'a pending request to a profile that later goes Public');
  update public.users set privacy_mode = 'Public' where user_id = p.switching_target;
  perform kc_test.assert_true(public.is_following(p.member, p.switching_target),
    'switching to Public turns the pending request into a follow edge');
end $$;

rollback;

\echo '✓ 0541_follow_edges_private_by_request.sql passed'
