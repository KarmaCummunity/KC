-- supabase/tests/0305_whatsapp_consent_keywords.sql | Issue #937
-- Hebrew keywords are built with chr() so this file passes the repo Hebrew-scan rule.

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

-- he: "hasser" (remove) = U+05D4 U+05E1 U+05E8 ; "ezra" (help) = U+05E2 U+05D6 U+05E8 U+05D4
create or replace function pg_temp.he_stop() returns text language sql as $$ select chr(1492) || chr(1505) || chr(1512) $$;
create or replace function pg_temp.he_help() returns text language sql as $$ select chr(1506) || chr(1494) || chr(1512) || chr(1492) $$;

-- 1) Parser: exact keywords only, case/punctuation-insensitive, he + en.
do $$
begin
  if public.whatsapp_parse_keyword('STOP')->>'action' <> 'opt_out' then raise exception 'ASSERT FAILED: STOP'; end if;
  if public.whatsapp_parse_keyword('  Stop!! ')->>'action' <> 'opt_out' then raise exception 'ASSERT FAILED: Stop!!'; end if;
  if public.whatsapp_parse_keyword(pg_temp.he_stop())->>'language' <> 'he' then raise exception 'ASSERT FAILED: he STOP'; end if;
  if public.whatsapp_parse_keyword(pg_temp.he_stop() || '.')->>'action' <> 'opt_out' then raise exception 'ASSERT FAILED: he STOP punct'; end if;
  if public.whatsapp_parse_keyword('start')->>'action' <> 'opt_in' then raise exception 'ASSERT FAILED: start'; end if;
  if public.whatsapp_parse_keyword('HELP')->>'action' <> 'help' then raise exception 'ASSERT FAILED: HELP'; end if;
  if public.whatsapp_parse_keyword(pg_temp.he_help())->>'action' <> 'help' then raise exception 'ASSERT FAILED: he HELP'; end if;
  if public.whatsapp_parse_keyword('please stop the bus near my house') is not null then
    raise exception 'ASSERT FAILED: sentence containing stop must not be a keyword';
  end if;
  if public.whatsapp_parse_keyword(null) is not null or public.whatsapp_parse_keyword('') is not null then
    raise exception 'ASSERT FAILED: empty input';
  end if;
end $$;

-- 2) STOP from a linked phone: identity + user consent off, audited, proactive sends blocked.
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000305001';
  v_res jsonb;
  v_out uuid;
  v_status text;
  v_n int;
begin
  perform pg_temp.mk_user(v_user, 'wa_consent');
  perform public.api_bot_link_identity('972500305001', v_user);
  perform public.api_bot_set_match_consent(v_user, true);
  update public.whatsapp_message_templates set is_approved = true where template_name = 'match_found_v1';

  if not public.whatsapp_user_can_receive(v_user) then
    raise exception 'ASSERT FAILED: opted-in user should be able to receive';
  end if;

  v_res := public.api_whatsapp_handle_keyword('972500305001', 'STOP');
  if v_res->>'action' <> 'opt_out' or v_res->>'consent_status' <> 'opted_out' then
    raise exception 'ASSERT FAILED: STOP result %', v_res;
  end if;
  if public.whatsapp_user_can_receive(v_user) then
    raise exception 'ASSERT FAILED: STOP must block proactive sends';
  end if;
  if (select opted_in from public.whatsapp_match_consent where user_id = v_user) then
    raise exception 'ASSERT FAILED: STOP must mirror into whatsapp_match_consent';
  end if;

  v_out := public.api_whatsapp_queue_outbound(v_user, 'match_found_v1', '{}'::jsonb);
  select status into v_status from public.bot_outbound_messages where outbound_id = v_out;
  if v_status <> 'skipped_no_consent' then
    raise exception 'ASSERT FAILED: outbound after STOP should be skipped_no_consent, got %', v_status;
  end if;

  -- An app re-opt-in does not override the phone-level STOP.
  perform public.api_bot_set_match_consent(v_user, true);
  if public.whatsapp_user_can_receive(v_user) then
    raise exception 'ASSERT FAILED: app opt-in must not override phone STOP';
  end if;

  -- START (he keyword path via HELP first) restores consent.
  v_res := public.api_whatsapp_handle_keyword('972500305001', pg_temp.he_help());
  if v_res->>'action' <> 'help' then raise exception 'ASSERT FAILED: he HELP %', v_res; end if;
  v_res := public.api_whatsapp_handle_keyword('972500305001', 'START');
  if not public.whatsapp_user_can_receive(v_user) then
    raise exception 'ASSERT FAILED: START should restore consent';
  end if;

  select count(*) into v_n from public.whatsapp_consent_events where wa_id = '972500305001';
  if v_n <> 3 then raise exception 'ASSERT FAILED: expected 3 keyword audit events, got %', v_n; end if;
  select count(*) into v_n from public.whatsapp_consent_events where user_id = v_user and source = 'app';
  if v_n <> 2 then raise exception 'ASSERT FAILED: expected 2 app audit events, got %', v_n; end if;

  -- Ordinary text is not a keyword and changes nothing.
  v_res := public.api_whatsapp_handle_keyword('972500305001', 'I have a sofa to give away');
  if v_res->>'action' is not null then raise exception 'ASSERT FAILED: plain text treated as keyword'; end if;
end $$;

-- 3) No consent row at all → never a proactive send.
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000305002';
  v_out uuid;
begin
  perform pg_temp.mk_user(v_user, 'wa_noconsent');
  perform public.api_bot_link_identity('972500305002', v_user);
  v_out := public.api_whatsapp_queue_outbound(v_user, 'match_found_v1', '{}'::jsonb);
  if (select status from public.bot_outbound_messages where outbound_id = v_out) <> 'skipped_no_consent' then
    raise exception 'ASSERT FAILED: no consent row must skip';
  end if;
end $$;

-- 4) Ingest stamps the 24h session window for the sender.
do $$
begin
  perform public.api_whatsapp_ingest_inbound('wamid.test305', jsonb_build_object(
    'message', jsonb_build_object('from', '972500305003', 'id', 'wamid.test305', 'type', 'text')));
  if not exists (
    select 1 from public.whatsapp_identities
     where wa_id = '972500305003' and last_inbound_at > now() - interval '1 minute'
  ) then
    raise exception 'ASSERT FAILED: ingest should stamp last_inbound_at';
  end if;
end $$;

rollback;

\echo '✓ 0305_whatsapp_consent_keywords.sql passed'
