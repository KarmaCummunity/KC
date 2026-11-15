-- supabase/tests/0309_whatsapp_e2e_bot_flow.sql | Issue #940
-- DB-side E2E: ingest → link → START/consent → queue match templates → STOP → skip.
-- No Edge Functions / Meta calls.

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
  v_a uuid := 'bbbbbbbb-0000-4000-8000-0000000000a1';
  v_b uuid := 'bbbbbbbb-0000-4000-8000-0000000000b2';
  v_rec uuid;
  v_n int;
  v_kw jsonb;
  v_out uuid;
begin
  perform pg_temp.mk_user(v_a, 'wa_e2e_a');
  perform pg_temp.mk_user(v_b, 'wa_e2e_b');

  update public.whatsapp_message_templates
     set is_approved = true
   where template_name = 'match_found_v1';

  v_rec := public.api_whatsapp_ingest_inbound(
    'wamid-e2e-1',
    jsonb_build_object(
      'message', jsonb_build_object(
        'from', '972500001111',
        'text', jsonb_build_object('body', 'sofa')
      )
    )
  );
  if v_rec is null then raise exception 'ASSERT FAILED: ingest returned null'; end if;

  -- Idempotent re-ingest
  if public.api_whatsapp_ingest_inbound(
       'wamid-e2e-1', jsonb_build_object('message', jsonb_build_object('from', '972500001111'))
     ) <> v_rec then
    raise exception 'ASSERT FAILED: ingest not idempotent';
  end if;

  perform public.api_bot_link_identity('972500001111', v_a);
  perform public.api_bot_link_identity('972500002222', v_b);

  v_kw := public.api_whatsapp_handle_keyword('972500001111', 'START', v_rec);
  if coalesce(v_kw->>'action', '') <> 'opt_in' then
    raise exception 'ASSERT FAILED: START action %', v_kw;
  end if;

  perform public.api_bot_set_match_consent(v_a, true);
  perform public.api_bot_set_match_consent(v_b, true);

  if not public.whatsapp_user_can_receive(v_a) then
    raise exception 'ASSERT FAILED: A should receive after opt-in';
  end if;

  v_out := public.api_whatsapp_queue_outbound(
    v_a, 'match_found_v1',
    jsonb_build_object('world_label', 'Items', 'world_label_he', 'Items', 'world_label_en', 'Items'), 5
  );
  if v_out is null then raise exception 'ASSERT FAILED: queue A'; end if;
  if not exists (
    select 1 from public.bot_outbound_messages where outbound_id = v_out and status = 'queued'
  ) then
    raise exception 'ASSERT FAILED: A outbound not queued (status check)';
  end if;

  perform public.api_whatsapp_queue_outbound(
    v_b, 'match_found_v1',
    jsonb_build_object('world_label', 'Items', 'world_label_he', 'Items', 'world_label_en', 'Items'), 5
  );

  select count(*) into v_n from public.bot_outbound_messages
   where user_id in (v_a, v_b) and template_name = 'match_found_v1' and status = 'queued';
  if v_n < 2 then raise exception 'ASSERT FAILED: expected 2 queued, got %', v_n; end if;

  -- STOP
  v_kw := public.api_whatsapp_handle_keyword('972500001111', 'STOP', null);
  if coalesce(v_kw->>'action', '') <> 'opt_out' then
    raise exception 'ASSERT FAILED: STOP action %', v_kw;
  end if;
  if public.whatsapp_user_can_receive(v_a) then
    raise exception 'ASSERT FAILED: A must not receive after STOP';
  end if;

  v_out := public.api_whatsapp_queue_outbound(
    v_a, 'match_found_v1',
    jsonb_build_object('world_label', 'Items'), 5
  );
  if not exists (
    select 1 from public.bot_outbound_messages
     where outbound_id = v_out and status = 'skipped_no_consent'
  ) then
    raise exception 'ASSERT FAILED: post-STOP must skip_no_consent';
  end if;

  raise notice '0309_whatsapp_e2e_bot_flow OK';
end $$;

rollback;
