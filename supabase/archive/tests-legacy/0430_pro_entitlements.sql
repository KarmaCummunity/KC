-- supabase/tests/0430_pro_entitlements.sql | Issue #1083

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
end $$;

do $$
declare
  v_a uuid := 'a4300001-0000-4000-8000-000000000001';
  v_b uuid := 'a4300002-0000-4000-8000-000000000002';
begin
  perform pg_temp.mk_user(v_a, 'pro_a');
  perform pg_temp.mk_user(v_b, 'pro_b');

  if public.is_pro(v_a) then raise exception 'no row must mean not pro'; end if;

  perform public.api_set_pro_entitlement(v_a, true, null, 'admin');
  if not public.is_pro(v_a) then raise exception 'active row must be pro'; end if;

  perform public.api_set_pro_entitlement(v_a, true, now() - interval '1 minute', 'revenuecat');
  if public.is_pro(v_a) then raise exception 'expired row must not be pro'; end if;

  perform public.api_set_pro_entitlement(v_a, false, null, 'admin');
  if public.is_pro(v_a) then raise exception 'inactive row must not be pro'; end if;

  perform public.api_set_pro_entitlement(v_b, true, now() + interval '1 day', 'promo');

  -- Client roles cannot call the internal check or the writer.
  if has_function_privilege('authenticated', 'public.is_pro(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_pro(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.api_set_pro_entitlement(uuid,boolean,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.api_my_pro_status()', 'EXECUTE') then
    raise exception 'SECURITY: client role can execute an internal Pro function';
  end if;
  if not has_function_privilege('authenticated', 'public.api_my_pro_status()', 'EXECUTE') then
    raise exception 'api_my_pro_status must be callable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.user_entitlements', 'INSERT')
     or has_table_privilege('authenticated', 'public.user_entitlements', 'UPDATE') then
    raise exception 'SECURITY: clients must not write user_entitlements';
  end if;
end $$;

-- RLS: user B sees only their own row, and their own status.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4300002-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.user_entitlements) <> 1 then
    raise exception 'RLS: user must see exactly their own entitlement row';
  end if;
  if not ((public.api_my_pro_status() ->> 'is_pro')::boolean) then
    raise exception 'api_my_pro_status must report pro for user B';
  end if;
end $$;

reset role;
rollback;

\echo '✓ 0430 pro entitlements test passed'
