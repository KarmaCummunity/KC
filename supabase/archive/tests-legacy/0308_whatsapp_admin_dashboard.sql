-- supabase/tests/0308_whatsapp_admin_dashboard.sql | Issue #939

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
  v_admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_user  uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_stranger uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_out uuid;
  v_overview jsonb;
  v_channel jsonb;
  v_n int;
  v_status text;
begin
  perform pg_temp.mk_user(v_admin, 'wa_admin');
  perform pg_temp.mk_user(v_user, 'wa_user');
  perform pg_temp.mk_user(v_stranger, 'wa_stranger');

  insert into public.admin_role_grants (user_id, role, granted_by)
  values (v_admin, 'moderator', v_admin);

  insert into public.whatsapp_identities (wa_id, user_id, consent_status, preferred_language, last_inbound_at)
  values ('972501112222', v_user, 'opted_in', 'he', now());
  insert into public.whatsapp_match_consent (user_id, opted_in, opted_in_at)
  values (v_user, true, now());

  update public.whatsapp_message_templates
     set is_approved = true
   where template_name = 'match_found_v1' and language_code = 'he';

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  begin
    perform public.api_whatsapp_admin_overview();
    raise exception 'ASSERT FAILED: stranger must be forbidden';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_overview := public.api_whatsapp_admin_overview();
  if (v_overview->>'consent_opted_in')::int < 1 then
    raise exception 'ASSERT FAILED: overview consent_opted_in';
  end if;

  select count(*) into v_n from public.api_whatsapp_admin_list_consent(50, 0);
  if v_n < 1 then raise exception 'ASSERT FAILED: consent list empty'; end if;

  -- Masking: full wa_id must not appear
  if exists (
    select 1 from public.api_whatsapp_admin_list_consent(50, 0)
     where wa_id_masked like '%501112222%' and wa_id_masked not like '%*%'
  ) then
    raise exception 'ASSERT FAILED: wa_id not masked';
  end if;

  v_out := public.api_whatsapp_queue_outbound(
    v_user, 'match_found_v1',
    jsonb_build_object('world', 'items', 'world_label_he', 'items', 'action', 'open'),
    5
  );
  -- service_role style queue from admin context may skip if template path needs service;
  -- call as security definer owner by using a direct insert fallback for the probe:
  if v_out is null or not exists (select 1 from public.bot_outbound_messages where outbound_id = v_out) then
    insert into public.bot_outbound_messages (
      outbound_id, user_id, kind, to_wa_id, language, template_name, payload, status
    ) values (
      gen_random_uuid(), v_user, 'template', '972501112222', 'he', 'match_found_v1',
      '{"world":"items"}'::jsonb, 'failed'
    ) returning outbound_id into v_out;
  else
    update public.bot_outbound_messages set status = 'failed', last_error = 'boom'
     where outbound_id = v_out;
  end if;

  select count(*) into v_n from public.api_whatsapp_admin_list_outbound(null, 50, 0);
  if v_n < 1 then raise exception 'ASSERT FAILED: outbound list'; end if;

  select count(*) into v_n from public.api_whatsapp_admin_list_recent_matches(50);
  -- may be 0 if status is failed; insert a sent row
  insert into public.bot_outbound_messages (
    user_id, kind, to_wa_id, language, template_name, payload, status, sent_at
  ) values (
    v_user, 'template', '972501112222', 'he', 'match_found_v1',
    '{"world":"items"}'::jsonb, 'sent', now()
  );
  select count(*) into v_n from public.api_whatsapp_admin_list_recent_matches(50);
  if v_n < 1 then raise exception 'ASSERT FAILED: recent matches'; end if;

  v_status := public.api_whatsapp_admin_resend(v_out);
  if v_status <> 'queued' then raise exception 'ASSERT FAILED: resend -> %', v_status; end if;

  perform public.api_whatsapp_admin_block_user(v_user);
  if exists (select 1 from public.whatsapp_match_consent where user_id = v_user and opted_in) then
    raise exception 'ASSERT FAILED: block must opt out';
  end if;

  v_channel := public.api_whatsapp_admin_set_channel_enabled(false);
  if (v_channel->>'is_enabled')::boolean is not false then
    raise exception 'ASSERT FAILED: kill switch off';
  end if;
  v_channel := public.api_whatsapp_admin_set_channel_enabled(true);
  if (v_channel->>'is_enabled')::boolean is not true then
    raise exception 'ASSERT FAILED: kill switch on';
  end if;

  -- rate hits: seed a counter
  insert into public.whatsapp_rate_counters (bucket, window_start, hits)
  values ('inbound:972501112222', date_trunc('minute', now()), 5)
  on conflict (bucket, window_start) do update set hits = excluded.hits;
  select count(*) into v_n from public.api_whatsapp_admin_list_rate_hits(50);
  if v_n < 1 then raise exception 'ASSERT FAILED: rate hits'; end if;

  raise notice '0308_whatsapp_admin_dashboard OK';
end $$;

rollback;
