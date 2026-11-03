-- supabase/tests/0434_whatsapp_agent_tools.sql | Issue #1091

begin;

do $$
begin
  if has_function_privilege('authenticated', 'public.api_bot_listing_cards(uuid,uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.api_bot_my_listings(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.api_bot_my_matches(uuid,integer)', 'EXECUTE') then
    raise exception 'SECURITY: client role can execute WhatsApp agent tool RPCs';
  end if;
  if not has_function_privilege('service_role', 'public.api_bot_my_matches(uuid,integer)', 'EXECUTE') then
    raise exception 'service_role must execute api_bot_my_matches';
  end if;
  -- Empty inputs are safe.
  if (select count(*) from public.api_bot_listing_cards(null, null)) <> 0 then
    raise exception 'null ids must return nothing';
  end if;
  if (select count(*) from public.api_bot_my_listings('00000000-0000-0000-0000-000000434001', 5)) <> 0
     or (select count(*) from public.api_bot_my_matches('00000000-0000-0000-0000-000000434001', 5)) <> 0 then
    raise exception 'unknown user must have no listings / matches';
  end if;
end $$;

rollback;

\echo '✓ 0434 whatsapp agent tools test passed'
