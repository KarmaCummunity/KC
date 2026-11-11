-- supabase/tests/0545_list_my_blocked_users.sql | 0545 (FR-MOD-004 AC1): the Blocked Users list
-- returns the caller's own blocks only, newest first, with the fields the screen shows, and
-- nothing for a member who blocked nobody or for an anonymous caller.

begin;

create temp table personas as
select kc_test.create_user('blocklist_owner') as owner,
       kc_test.create_user('blocklist_first') as first_blocked,
       kc_test.create_user('blocklist_second') as second_blocked,
       kc_test.create_user('blocklist_other') as other;

insert into public.blocks (blocker_id, blocked_id, created_at)
select owner, first_blocked, now() - interval '2 days' from personas
union all
select owner, second_blocked, now() - interval '1 day' from personas
union all
-- Someone else's block must never appear in the owner's list.
select other, owner, now() from personas;

do $$
declare
  p personas;
  v_ids uuid[];
  v_name text;
begin
  select * into p from personas;
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.list_my_blocked_users()', 'execute'),
    'anon cannot list blocks');

  perform kc_test.act_as(p.owner);
  select array_agg(user_id order by blocked_at desc) into v_ids from public.list_my_blocked_users();
  perform kc_test.assert_eq(v_ids, array[p.second_blocked, p.first_blocked],
    'the owner sees the two members they blocked, newest first');
  select display_name into v_name from public.list_my_blocked_users() where user_id = p.first_blocked;
  perform kc_test.assert_eq(v_name, 'Test blocklist_first', 'with the blocked member''s display name');

  perform kc_test.act_as(p.first_blocked);
  perform kc_test.assert_eq((select count(*) from public.list_my_blocked_users())::integer, 0,
    'a member who blocked nobody gets an empty list');

  perform kc_test.act_as_anon();
  perform kc_test.assert_eq((select count(*) from public.list_my_blocked_users())::integer, 0,
    'no session, no rows');
end $$;

rollback;

\echo '✓ 0545_list_my_blocked_users.sql passed'
