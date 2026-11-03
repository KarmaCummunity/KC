-- supabase/tests/0200_rpc_require_active_member.sql
-- Regression for migration 0200 (TD-87).
--
-- Six SECURITY DEFINER mutation RPCs now reject non-active callers with
-- `account_not_active`. This test impersonates a suspended user and asserts each
-- is blocked, then impersonates active users and asserts the happy paths still
-- work (close/reopen happy paths are covered by 0199's test; here we cover the
-- three RPCs no other test exercises: recipient_unmark, chat_set_anchor,
-- submit_support_issue).
--
-- Runs under `authenticated` (the harness is otherwise postgres, which bypasses
-- the gate). Wrapped in a rolled-back transaction; ON_ERROR_STOP=1 fails CI on
-- any raise.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text, p_status text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'D ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'D ' || p_handle,
         privacy_mode = 'Public', account_status = p_status
   where user_id = p_id;
end $$;

create or replace function pg_temp.expect_blocked(p_sql text, p_expect text)
returns void language plpgsql as $$
declare v_blocked boolean := false;
begin
  begin execute p_sql;
  exception when others then
    v_blocked := true;
    if sqlerrm not like '%' || p_expect || '%' then
      raise exception 'ASSERT FAILED: expected "%", got: %', p_expect, sqlerrm;
    end if;
  end;
  if not v_blocked then
    raise exception 'ASSERT FAILED: should have been blocked: %', p_sql;
  end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.expect_blocked(text, text) to public;

-- Seed: active A + active B + suspended S; S owns an open post; A owns a
-- closed_delivered post (B is its recipient) + a public open post; A-B chat.
do $$
declare v_city text;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000020000a1', 'td87_a', 'active');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000020000b2', 'td87_b', 'active');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000020000c3', 'td87_s', 'suspended_admin');
  select city_id into v_city from public.cities limit 1;

  insert into public.posts (post_id, owner_id, type, status, visibility, title, description, category, city, street, street_number)
  values ('00000000-0000-0000-0000-00000200d401','00000000-0000-0000-0000-0000020000c3','Give','open','Public','S open','d','Other',v_city,'Herzl','1'),
         ('00000000-0000-0000-0000-00000200e502','00000000-0000-0000-0000-0000020000a1','Give','closed_delivered','Public','A closed','d','Other',v_city,'Herzl','2'),
         ('00000000-0000-0000-0000-00000200f603','00000000-0000-0000-0000-0000020000a1','Give','open','Public','A public','d','Other',v_city,'Herzl','3');

  insert into public.recipients (post_id, recipient_user_id)
  values ('00000000-0000-0000-0000-00000200e502','00000000-0000-0000-0000-0000020000b2');

  insert into public.chats (chat_id, participant_a, participant_b, is_support_thread)
  values ('00000000-0000-0000-0000-00000200c007','00000000-0000-0000-0000-0000020000a1','00000000-0000-0000-0000-0000020000b2', false);
end $$;

-- ── BLOCKED: a suspended user cannot drive five of the six RPCs (support stays open, D61) ──
select set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-0000-0000-0000020000c3','role','authenticated')::text, true);
set local role authenticated;

-- closure/reopen: S owns post …d401, so the owner check passes and the
-- active-member gate (placed before the status check) is what rejects.
select pg_temp.expect_blocked($q$select public.close_post_with_recipient('00000000-0000-0000-0000-00000200d401','00000000-0000-0000-0000-0000020000b2')$q$,'account_not_active');
select pg_temp.expect_blocked($q$select public.reopen_post_marked('00000000-0000-0000-0000-00000200d401')$q$,'account_not_active');
select pg_temp.expect_blocked($q$select public.reopen_post_deleted_no_recipient('00000000-0000-0000-0000-00000200d401')$q$,'account_not_active');
-- these three gate immediately after the auth.uid() check:
select pg_temp.expect_blocked($q$select public.rpc_recipient_unmark_self('00000000-0000-0000-0000-00000200d401')$q$,'account_not_active');
select pg_temp.expect_blocked($q$select public.rpc_chat_set_anchor('00000000-0000-0000-0000-00000200c007','00000000-0000-0000-0000-00000200f603')$q$,'account_not_active');
-- D61 (0452): a suspended user may still contact support.
select public.rpc_submit_support_issue('Bug','a sufficiently long description');

-- ── ALLOWED: active recipient B can unmark themselves ──
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-0000-0000-0000020000b2','role','authenticated')::text, true);
set local role authenticated;
select public.rpc_recipient_unmark_self('00000000-0000-0000-0000-00000200e502');
do $$
begin
  if (select status from public.posts where post_id='00000000-0000-0000-0000-00000200e502') <> 'deleted_no_recipient' then
    raise exception 'ASSERT FAILED: recipient_unmark did not transition to deleted_no_recipient';
  end if;
end $$;

-- ── ALLOWED: active participant A can set the chat anchor + submit support ──
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-0000-0000-0000020000a1','role','authenticated')::text, true);
set local role authenticated;
select public.rpc_chat_set_anchor('00000000-0000-0000-0000-00000200c007','00000000-0000-0000-0000-00000200f603');
do $$
begin
  if (select anchor_post_id from public.chats where chat_id='00000000-0000-0000-0000-00000200c007')
     <> '00000000-0000-0000-0000-00000200f603' then
    raise exception 'ASSERT FAILED: chat_set_anchor did not set the anchor';
  end if;
end $$;
select public.rpc_submit_support_issue('Bug','this is a valid support description');

do $$ begin raise notice '✓ 0200: suspended user blocked on 5 RPCs, may still contact support; active users pass'; end $$;

reset role;
rollback;

\echo '✓ 0200 rpc require-active-member regression test passed'
