-- supabase/tests/0550_kc_support_payee_phone.sql
-- Regression for migration 0550 (FR-DONATE-011 AC9).
--
-- Asserts the privacy contract of the payee phone:
--   1. guests calling list_kc_support_channels() get the channels with payee_phone NULL;
--   2. guests cannot read the payee_phone column directly (column grant, 42501);
--   3. signed-in callers get the number;
--   4. CHECKs reject a malformed number and a number on a card channel.
-- Uses a fictitious test number and runs in a rolled-back transaction.

begin;

-- Seed: a fictitious payee number on the seeded Bit row.
update public.kc_support_channels set payee_phone = '0500000000' where channel = 'bit';

-- 4. CHECKs — evaluated as postgres (bypasses RLS, not CHECK constraints).
do $$
begin
  begin
    update public.kc_support_channels set payee_phone = '+972500000000' where channel = 'paybox';
    raise exception 'ASSERT FAILED: payee_phone format CHECK accepted an international-format number';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.kc_support_channels (channel, url, provider_label, payee_phone)
    values ('card_one_time', 'https://pay.example.com/once', 'Test', '0500000000');
    raise exception 'ASSERT FAILED: payee_phone accepted on a card channel';
  exception when check_violation then
    null;
  end;
end $$;

-- 1 + 2. Guest.
select set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_phone text;
begin
  select payee_phone into v_phone from public.list_kc_support_channels() where channel = 'bit';
  if not found then
    raise exception 'ASSERT FAILED: guest did not receive the active Bit channel';
  end if;
  if v_phone is not null then
    raise exception 'ASSERT FAILED: guest received the payee phone';
  end if;

  begin
    perform payee_phone from public.kc_support_channels;
    raise exception 'ASSERT FAILED: guest read payee_phone directly';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

-- 3. Signed-in caller.
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

do $$
declare v_user uuid := pg_temp.mk_user('t549_' || substr(gen_random_uuid()::text, 1, 8));
begin
  -- Both forms: newer auth.uid() reads `request.jwt.claims`, older builds read
  -- `request.jwt.claim.sub`; the assertion must not depend on which one is live.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_user::text, true);
end $$;

set local role authenticated;
do $$
declare v_phone text;
begin
  select payee_phone into v_phone from public.list_kc_support_channels() where channel = 'bit';
  if v_phone is distinct from '0500000000' then
    raise exception 'ASSERT FAILED: signed-in caller expected the payee phone, got %', v_phone;
  end if;
end $$;
reset role;

rollback;

\echo '✓ 0550 kc_support payee phone privacy regression test passed'
