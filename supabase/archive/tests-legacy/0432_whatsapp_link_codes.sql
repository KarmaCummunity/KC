-- supabase/tests/0432_whatsapp_link_codes.sql | Issue #1090

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

create temp table t_codes (who text primary key, code text);
grant all on t_codes to authenticated;

select pg_temp.mk_user('a4320001-0000-4000-8000-000000000001', 'wa_pro');
select pg_temp.mk_user('a4320002-0000-4000-8000-000000000002', 'wa_free');
select public.api_set_pro_entitlement('a4320001-0000-4000-8000-000000000001', true, null, 'admin');

-- Free user cannot get a code.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4320002-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.api_whatsapp_create_link_code();
    raise exception 'free user must not get a link code';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Pro user gets a 6-digit code.
select set_config('request.jwt.claims', '{"sub":"a4320001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into t_codes values ('pro', public.api_whatsapp_create_link_code() ->> 'code');
do $$
begin
  if (select code from t_codes where who = 'pro') !~ '^[0-9]{6}$' then
    raise exception 'code must be 6 digits';
  end if;
  if (public.api_whatsapp_my_link_status() ->> 'linked')::boolean then
    raise exception 'must not be linked yet';
  end if;
end $$;
reset role;

do $$
declare
  v_code text := (select code from t_codes where who = 'pro');
  v_wrong text := lpad(((v_code::int + 1) % 1000000)::text, 6, '0');
  i int;
begin
  if public.api_whatsapp_redeem_link_code('972500432001', v_wrong) ->> 'status' <> 'invalid' then
    raise exception 'wrong code must be invalid';
  end if;
  if public.api_whatsapp_redeem_link_code('972500432001', v_code) ->> 'status' <> 'linked' then
    raise exception 'right code must link';
  end if;
  if (select user_id from public.whatsapp_identities where wa_id = '972500432001')
     <> 'a4320001-0000-4000-8000-000000000001' then
    raise exception 'identity must be linked to the pro user';
  end if;
  if public.api_whatsapp_redeem_link_code('972500432001', v_code) ->> 'status' <> 'invalid' then
    raise exception 'code must be one-time';
  end if;
  -- Lockout after 5 failures per hour.
  for i in 1..5 loop
    perform public.api_whatsapp_redeem_link_code('972500432999', '000000');
  end loop;
  if public.api_whatsapp_redeem_link_code('972500432999', '000000') ->> 'status' <> 'locked' then
    raise exception 'must lock after 5 failures';
  end if;
  if has_function_privilege('authenticated', 'public.api_whatsapp_redeem_link_code(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.api_whatsapp_create_link_code()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.whatsapp_link_codes', 'SELECT') then
    raise exception 'SECURITY: client role reaches link-code internals';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4320001-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (public.api_whatsapp_my_link_status() ->> 'wa_id_masked') <> '•••2001' then
    raise exception 'status must show masked linked number';
  end if;
  perform public.api_whatsapp_unlink_me();
  if (public.api_whatsapp_my_link_status() ->> 'linked')::boolean then
    raise exception 'unlink must clear the link';
  end if;
end $$;
reset role;

rollback;

\echo '✓ 0432 whatsapp link codes test passed'
