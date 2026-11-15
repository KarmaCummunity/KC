-- supabase/tests/0270_payments.sql | Issue #850

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_user uuid := '00000000-0000-0000-0000-000000270001';
  v_evt uuid;
  v_evt2 uuid;
begin
  perform pg_temp.mk_user(v_user, 'donor1');
  update public.organizations set is_verified_nonprofit = true where org_id = v_org;

  v_evt := public.provider_webhook_apply('sandbox', 'evt-dedupe-1', '{"type":"test"}'::jsonb);
  v_evt2 := public.provider_webhook_apply('sandbox', 'evt-dedupe-1', '{"type":"test"}'::jsonb);
  if v_evt is null or v_evt2 is null or v_evt <> v_evt2 then
    raise exception 'ASSERT FAILED: webhook dedupe should return same event id';
  end if;

  begin
    perform public.payment_ledger_post_balanced(
      gen_random_uuid(),
      jsonb_build_array(
        jsonb_build_object('account', 'cash', 'debit', 100, 'credit', 0),
        jsonb_build_object('account', 'revenue', 'debit', 0, 'credit', 50)
      ),
      'txn-unbalanced'
    );
    raise exception 'ASSERT FAILED: unbalanced ledger should fail';
  exception when others then
    if sqlstate <> '23514' then raise; end if;
  end;

  perform public.payment_ledger_post_balanced(
    gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'debit', 36, 'credit', 0),
      jsonb_build_object('account', 'revenue', 'debit', 0, 'credit', 36)
    ),
    'txn-balanced'
  );
end $$;

rollback;

\echo '✓ 0270_payments.sql passed'
