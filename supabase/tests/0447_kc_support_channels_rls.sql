-- supabase/tests/0447_kc_support_channels_rls.sql
-- Regression for migration 0447 (FR-DONATE-011).
--
-- Asserts the security contract of public.kc_support_channels:
--   1. anon can read active channels (guest-visible support CTA);
--   2. a plain authenticated user can read but NOT redirect donor money
--      (insert/update are silently filtered or rejected by RLS);
--   3. the URL CHECK rejects non-HTTPS and credential-bearing URLs.
-- Runs in a rolled-back transaction so it leaves no rows behind.

begin;

-- Precondition: anon has no EXECUTE on has_admin_role (0161). The anon read below
-- proves the anon policy never calls it — a regression would raise 42501 there.
do $$
begin
  if has_function_privilege('anon', 'public.has_admin_role(uuid, text)', 'EXECUTE') then
    raise exception 'PRECONDITION FAILED: anon should NOT have EXECUTE on has_admin_role (0161)';
  end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  return v_id;
end $$;

-- 3. URL CHECK — evaluated as postgres (bypasses RLS, not CHECK constraints).
do $$
declare v_bad text;
begin
  foreach v_bad in array array[
    'http://pay.example.com/x',
    'https://user:pass@pay.example.com/x',
    'javascript:alert(1)',
    'https://pay.example.com/a b'
  ] loop
    begin
      insert into public.kc_support_channels (channel, url, provider_label)
      values ('card_one_time', v_bad, 'Test');
      raise exception 'ASSERT FAILED: URL CHECK accepted %', v_bad;
    exception when check_violation then
      null;
    end;
  end loop;
end $$;

-- 1. anon read.
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.kc_support_channels where channel in ('bit', 'paybox');
  if n <> 2 then
    raise exception 'ASSERT FAILED: anon expected 2 seeded channels, got %', n;
  end if;
end $$;
reset role;

-- 2. Plain authenticated user cannot write.
do $$
declare v_user uuid := pg_temp.mk_user('t447_' || substr(gen_random_uuid()::text, 1, 8));
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text,
    true
  );
end $$;

set local role authenticated;
do $$
declare n int;
begin
  update public.kc_support_channels set url = 'https://attacker.example/steal' where channel = 'bit';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'ASSERT FAILED: non-admin updated % support channel rows', n;
  end if;

  begin
    insert into public.kc_support_channels (channel, url, provider_label)
    values ('card_one_time', 'https://attacker.example/steal', 'Evil');
    raise exception 'ASSERT FAILED: non-admin inserted a support channel';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

rollback;

\echo '✓ 0447 kc_support_channels RLS + URL CHECK regression test passed'
