-- supabase/tests/0742_support_issue_length_bounds.sql | #2096, FR-MOD-002 AC1 / AC6:
-- a support-issue description is 10–500 characters after trim, enforced by the server so no
-- client can bypass it; an accepted report lands in the reporter's support thread.

begin;

create temp table personas as
select kc_test.create_user('support_reporter') as reporter,
       kc_test.create_user('support_admin') as admin;

-- The support thread needs a super admin on the other side (find_or_create_support_chat).
-- Clear any seeded super admin first so the thread always pairs with this test's admin.
update public.users set is_super_admin = (user_id = (select admin from personas))
 where user_id = (select admin from personas) or is_super_admin;

do $$
declare
  p personas;
  v_chat public.chats;
begin
  select * into p from personas;
  perform kc_test.act_as(p.reporter);

  perform kc_test.assert_raises(
    'select public.rpc_submit_support_issue(''Bug'', ''  too short  '')',
    'description_too_short', 'nine visible characters are refused');
  perform kc_test.assert_raises(
    format('select public.rpc_submit_support_issue(%L, %L)', 'Bug', repeat('x', 501)),
    'description_too_long', 'over 500 characters is refused');

  -- Exactly 500 visible characters, padded with spaces that trim removes, is accepted.
  v_chat := public.rpc_submit_support_issue('Bug', '  ' || repeat('x', 500) || '  ');
  perform kc_test.assert_true(v_chat.is_support_thread, 'the report opens the support thread');
  perform kc_test.assert_row_count(
    format('select 1 from public.messages where chat_id = %L and body = %L',
           v_chat.chat_id, '[Bug] ' || repeat('x', 500)),
    1, 'the trimmed report is stored in the thread');

  -- D61 (0452) still holds: a suspended member can contact support, within the same bounds.
  update public.users set account_status = 'suspended_admin' where user_id = p.reporter;
  v_chat := public.rpc_submit_support_issue(null, 'my account was suspended by mistake');
  perform kc_test.assert_true(v_chat.is_support_thread, 'a suspended member still reaches support');
  perform kc_test.assert_raises(
    format('select public.rpc_submit_support_issue(%L, %L)', 'Account', repeat('x', 501)),
    'description_too_long', 'the bound applies to a suspended member too');
end $$;

\echo '✓ 0742_support_issue_length_bounds.sql passed'

rollback;
