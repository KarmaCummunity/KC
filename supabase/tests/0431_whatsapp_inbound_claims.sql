-- supabase/tests/0431_whatsapp_inbound_claims.sql | Issue #1089

begin;

do $$
begin
  if not public.api_whatsapp_claim_inbound('wamid.test0431') then
    raise exception 'first claim must succeed';
  end if;
  if public.api_whatsapp_claim_inbound('wamid.test0431') then
    raise exception 'duplicate claim must be rejected';
  end if;
  perform public.api_whatsapp_release_inbound('wamid.test0431');
  if not public.api_whatsapp_claim_inbound('wamid.test0431') then
    raise exception 'released id must be claimable again';
  end if;
  if has_function_privilege('authenticated', 'public.api_whatsapp_claim_inbound(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.api_whatsapp_release_inbound(text)', 'EXECUTE') then
    raise exception 'SECURITY: client role can execute WhatsApp claim functions';
  end if;
end $$;

rollback;

\echo '✓ 0431 whatsapp inbound claims test passed'
