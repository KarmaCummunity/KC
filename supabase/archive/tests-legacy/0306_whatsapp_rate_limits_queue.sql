-- supabase/tests/0306_whatsapp_rate_limits_queue.sql | Issue #938

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

create or replace function pg_temp.opted_in_user(p_id uuid, p_handle text, p_wa text)
returns void language plpgsql as $$
begin
  perform pg_temp.mk_user(p_id, p_handle);
  perform public.api_bot_link_identity(p_wa, p_id);
  perform public.api_bot_set_match_consent(p_id, true);
end $$;

update public.whatsapp_message_templates set is_approved = true where template_name = 'match_found_v1';
update public.whatsapp_send_limits
   set per_user_hour = 3, per_user_day = 4, global_per_minute = 2,
       global_template_recipients_day = 2, inbound_per_phone_minute = 3,
       llm_per_phone_day = 2, llm_global_day = 3, max_attempts = 2, backoff_base_seconds = 30;
-- isolate from queue rows other test files may have left behind in this DB
update public.bot_outbound_messages set status = 'failed' where status in ('queued', 'sending');

-- 1) Inbound throttle and LLM budgets (per phone + global).
do $$
declare
  i int;
  v_ok boolean;
begin
  for i in 1..3 loop
    if not public.api_whatsapp_inbound_allowed('972500306009') then raise exception 'ASSERT FAILED: inbound % should pass', i; end if;
  end loop;
  if public.api_whatsapp_inbound_allowed('972500306009') then raise exception 'ASSERT FAILED: 4th inbound should throttle'; end if;
  if not public.api_whatsapp_inbound_allowed('972500306008') then raise exception 'ASSERT FAILED: throttle is per phone'; end if;

  if not public.api_whatsapp_llm_budget_take('972500306009') then raise exception 'ASSERT FAILED: llm 1'; end if;
  if not public.api_whatsapp_llm_budget_take('972500306009') then raise exception 'ASSERT FAILED: llm 2'; end if;
  if public.api_whatsapp_llm_budget_take('972500306009') then raise exception 'ASSERT FAILED: per-phone llm budget'; end if;
  v_ok := public.api_whatsapp_llm_budget_take('972500306008');   -- global hit 3
  if not v_ok then raise exception 'ASSERT FAILED: llm global 3'; end if;
  if public.api_whatsapp_llm_budget_take('972500306007') then raise exception 'ASSERT FAILED: global llm budget'; end if;
end $$;

-- 2) Per-user caps, unapproved templates, global unique-recipient tier cap.
do $$
declare
  a uuid := '00000000-0000-0000-0000-000000306001';
  b uuid := '00000000-0000-0000-0000-000000306002';
  c uuid := '00000000-0000-0000-0000-000000306003';
  v_out uuid;
  i int;
  st text;
begin
  perform pg_temp.opted_in_user(a, 'wa_rl_a', '972500306001');
  perform pg_temp.opted_in_user(b, 'wa_rl_b', '972500306002');
  perform pg_temp.opted_in_user(c, 'wa_rl_c', '972500306003');

  for i in 1..3 loop
    v_out := public.api_whatsapp_queue_outbound(a, 'match_found_v1', '{}'::jsonb);
    if (select status from public.bot_outbound_messages where outbound_id = v_out) <> 'queued' then
      raise exception 'ASSERT FAILED: send % should queue', i;
    end if;
  end loop;
  v_out := public.api_whatsapp_queue_outbound(a, 'match_found_v1', '{}'::jsonb);
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'skipped_rate_limit' then raise exception 'ASSERT FAILED: per-user hour cap, got %', st; end if;

  v_out := public.api_whatsapp_queue_outbound(b, 'intake_confirm_v1', '{}'::jsonb);
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'skipped_template_unapproved' then raise exception 'ASSERT FAILED: unapproved template, got %', st; end if;

  v_out := public.api_whatsapp_queue_outbound(b, 'match_found_v1', '{}'::jsonb);   -- 2nd unique recipient
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'queued' then raise exception 'ASSERT FAILED: b should queue, got %', st; end if;
  v_out := public.api_whatsapp_queue_outbound(c, 'match_found_v1', '{}'::jsonb);   -- 3rd > tier 2
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'skipped_global_cap' then raise exception 'ASSERT FAILED: global tier cap, got %', st; end if;
end $$;

-- 3) 24h session window for free-form replies; STOP confirmation still allowed.
do $$
declare
  v_out uuid;
  st text;
begin
  insert into public.whatsapp_identities (wa_id, last_inbound_at)
  values ('972500306010', now() - interval '25 hours'), ('972500306011', now() - interval '1 hour');

  v_out := public.api_whatsapp_queue_reply('972500306010', 'hi', 'reply');
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'skipped_outside_window' then raise exception 'ASSERT FAILED: outside 24h window, got %', st; end if;

  v_out := public.api_whatsapp_queue_reply('972500306011', 'hi', 'reply');
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'queued' then raise exception 'ASSERT FAILED: inside window should queue, got %', st; end if;

  perform public.api_whatsapp_handle_keyword('972500306011', 'stop');
  v_out := public.api_whatsapp_queue_reply('972500306011', 'more', 'reply');
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'skipped_no_consent' then raise exception 'ASSERT FAILED: reply after STOP, got %', st; end if;
  v_out := public.api_whatsapp_queue_reply('972500306011', 'unsubscribed', 'consent_confirmation');
  select status into st from public.bot_outbound_messages where outbound_id = v_out;
  if st <> 'queued' then raise exception 'ASSERT FAILED: STOP confirmation should queue, got %', st; end if;
end $$;

-- 4) Claim honours the global per-minute cap; results drive backoff / archive / sent.
do $$
declare
  v_ids uuid[];
  v_n int;
  v_res text;
  v_win timestamptz := public.whatsapp_rate_window(60);
  r public.bot_outbound_messages;
begin
  select array_agg(outbound_id) into v_ids from public.api_whatsapp_outbound_claim(10, 60);
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n <> 2 then raise exception 'ASSERT FAILED: global per-minute cap 2, claimed %', v_n; end if;
  select count(*) into v_n from public.api_whatsapp_outbound_claim(10, 60);
  -- (skip if the wall-clock minute rolled over between the two claims)
  if v_n <> 0 and public.whatsapp_rate_window(60) = v_win then
    raise exception 'ASSERT FAILED: cap exhausted this minute, claimed %', v_n;
  end if;
  update public.bot_outbound_messages set status = 'failed' where status = 'sending' and outbound_id <> all (v_ids);

  v_res := public.api_whatsapp_outbound_result(v_ids[1], true, 'wamid.ok');
  if v_res <> 'sent' then raise exception 'ASSERT FAILED: success → sent, got %', v_res; end if;
  if public.api_whatsapp_outbound_result(v_ids[1], false, null, 'dup', true) <> 'sent' then
    raise exception 'ASSERT FAILED: result must be idempotent once final';
  end if;

  v_res := public.api_whatsapp_outbound_result(v_ids[2], false, null, 'HTTP 429', true);
  if v_res <> 'queued' then raise exception 'ASSERT FAILED: retryable → queued, got %', v_res; end if;
  select * into r from public.bot_outbound_messages where outbound_id = v_ids[2];
  if r.attempts <> 1 or r.next_attempt_at < now() + interval '29 seconds' then
    raise exception 'ASSERT FAILED: backoff not applied (attempts %, next %)', r.attempts, r.next_attempt_at;
  end if;

  -- simulate the re-claim after backoff, then a 2nd retryable failure hits max_attempts=2
  update public.bot_outbound_messages set status = 'sending', claimed_at = now() where outbound_id = v_ids[2];
  v_res := public.api_whatsapp_outbound_result(v_ids[2], false, null, 'HTTP 503', true);
  if v_res <> 'failed' then raise exception 'ASSERT FAILED: max attempts → failed, got %', v_res; end if;
end $$;

-- 5) Consent is rechecked at claim time (STOP after queueing).
do $$
declare
  d uuid := '00000000-0000-0000-0000-000000306004';
  v_out uuid;
begin
  update public.whatsapp_send_limits set global_per_minute = 1000, global_template_recipients_day = 1000;
  update public.bot_outbound_messages set status = 'failed' where status in ('queued', 'sending');
  perform pg_temp.opted_in_user(d, 'wa_rl_d', '972500306004');
  v_out := public.api_whatsapp_queue_outbound(d, 'match_found_v1', '{}'::jsonb);
  perform public.api_whatsapp_handle_keyword('972500306004', 'STOP');
  perform * from public.api_whatsapp_outbound_claim(10, 60);
  if (select status from public.bot_outbound_messages where outbound_id = v_out) <> 'skipped_no_consent' then
    raise exception 'ASSERT FAILED: STOP after queueing must cancel the send at claim';
  end if;
end $$;

rollback;

\echo '✓ 0306_whatsapp_rate_limits_queue.sql passed'
