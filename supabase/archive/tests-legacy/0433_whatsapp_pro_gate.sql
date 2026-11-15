-- supabase/tests/0433_whatsapp_pro_gate.sql | Issue #1086

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('a4330001-0000-4000-8000-000000000001', 'gate_user@test.local', now(),
        '{"full_name":"Gate User"}', '{"provider":"email"}', 'authenticated', 'authenticated');

insert into public.whatsapp_identities (wa_id) values ('972500433001');
insert into public.whatsapp_identities (wa_id, user_id)
values ('972500433002', 'a4330001-0000-4000-8000-000000000001');

do $$
declare r jsonb;
begin
  r := public.api_whatsapp_bot_access('972500433001');
  if r ->> 'access' <> 'unlinked' or not (r ->> 'upsell')::boolean then
    raise exception 'unlinked number must get one upsell: %', r;
  end if;
  r := public.api_whatsapp_bot_access('972500433001');
  if (r ->> 'upsell')::boolean then
    raise exception 'upsell must be rate-limited to once per 24h';
  end if;

  r := public.api_whatsapp_bot_access('972500433002');
  if r ->> 'access' <> 'not_pro' or not (r ->> 'upsell')::boolean then
    raise exception 'linked free user must be not_pro with upsell: %', r;
  end if;

  perform public.api_set_pro_entitlement('a4330001-0000-4000-8000-000000000001', true, null, 'admin');
  r := public.api_whatsapp_bot_access('972500433002');
  if r ->> 'access' <> 'pro' or (r ->> 'upsell')::boolean then
    raise exception 'pro user must get access without upsell: %', r;
  end if;

  if has_function_privilege('authenticated', 'public.api_whatsapp_bot_access(text)', 'EXECUTE') then
    raise exception 'SECURITY: clients must not call api_whatsapp_bot_access';
  end if;
end $$;

rollback;

\echo '✓ 0433 whatsapp pro gate test passed'
