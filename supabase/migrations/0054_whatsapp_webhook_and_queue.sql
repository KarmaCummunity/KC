-- WhatsApp bot · webhook contract, outbound queue and sender contract (M22 / L7)
--
-- The functions the whatsapp-webhook and whatsapp-sender Edge Functions call, with the names
-- and return shapes of the pre-baseline contract, so the handlers keep working:
--   webhook  api_whatsapp_claim_inbound, _release_inbound, _inbound_allowed, _ingest_inbound,
--            _handle_keyword, _queue_reply, _bot_access, _llm_budget_take
--   sender   api_whatsapp_channel_config (new: the sender cannot read `integrations`),
--            api_whatsapp_outbound_claim, api_whatsapp_outbound_result
-- Every `api_*` function is executable by the service role only (default privileges).
--
-- A proactive message (template) is queued by kc_private.whatsapp_queue_template. Its gates,
-- in order: channel switched off → member consent → a number of the member → an approved
-- template in the member's language (else Hebrew, else English) → per-member hour and day
-- caps → the global daily recipient cap. Each outcome is a row with its status; nothing raises.
--
-- Errors (P0001): message_id_required, wa_id_required, invalid_reply_kind, body_required,
-- body_too_long, outbound_not_found.

-- ── Inbound ─────────────────────────────────────────────────────────────────
-- Claims a message id: true on the first delivery, false for a retry of a claimed one.
create function public.api_whatsapp_claim_inbound(p_message_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_message_id is null or btrim(p_message_id) = '' then
    raise exception 'message_id_required' using errcode = 'P0001';
  end if;
  insert into integrations.whatsapp_inbound_claims (message_id) values (p_message_id)
  on conflict (message_id) do nothing;
  return found;
end;
$$;
comment on function public.api_whatsapp_claim_inbound(text) is 'Webhook: claims an inbound message id; false when it was already claimed.';

-- Releases a claim after a failed processing, so Meta's retry is handled.
create function public.api_whatsapp_release_inbound(p_message_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from integrations.whatsapp_inbound_claims c where c.message_id = p_message_id;
$$;
comment on function public.api_whatsapp_release_inbound(text) is 'Webhook: releases the claim of an inbound message id.';

-- Counts one inbound message of a number; false above the per-number minute limit.
create function public.api_whatsapp_inbound_allowed(p_wa_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  return kc_private.rate_limit('wa_in:' || p_wa_id, (kc_private.whatsapp_limits()).inbound_per_phone_minute,
                               interval '1 minute');
end;
$$;
comment on function public.api_whatsapp_inbound_allowed(text) is 'Webhook: inbound throttle per number.';

-- Stores an inbound message once (idempotent on the message id) and opens the number's
-- 24-hour window. Returns the inbound row id. p_run_id is ignored (signature compatibility).
create function public.api_whatsapp_ingest_inbound(p_message_id text, p_payload jsonb, p_run_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from constant text := nullif(btrim(coalesce(p_payload #>> '{message,from}', p_payload ->> 'from')), '');
  v_keep constant interval := coalesce(
    (select r.keep from kc_private.retention_rules r where r.name = 'whatsapp_inbound_messages'), interval '90 days');
  v_id uuid;
begin
  if p_message_id is null or btrim(p_message_id) = '' then
    raise exception 'message_id_required' using errcode = 'P0001';
  end if;
  select m.id into v_id from integrations.whatsapp_inbound_messages m where m.message_id = p_message_id;
  if found then
    return v_id;
  end if;
  insert into integrations.whatsapp_inbound_messages (message_id, wa_id, payload, retain_until)
  values (p_message_id, v_from, coalesce(p_payload, '{}'::jsonb), now() + v_keep)
  returning id into v_id;
  if v_from is not null then
    insert into integrations.whatsapp_identities as i (wa_id, last_inbound_at) values (v_from, now())
    on conflict (wa_id) do update set last_inbound_at = now();
  end if;
  return v_id;
end;
$$;
comment on function public.api_whatsapp_ingest_inbound(text, jsonb, uuid) is
  'Webhook: stores an inbound message (idempotent) and opens the number''s 24-hour window.';

-- Applies a STOP / START / HELP keyword: the number's consent and language, the linked
-- member's alert opt-in, and a consent event. Returns {action, language, consent_status};
-- {action: null} when the text is not a keyword. p_record_id is the inbound row id.
create function public.api_whatsapp_handle_keyword(p_wa_id text, p_text text, p_record_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kw constant jsonb := kc_private.whatsapp_parse_keyword(p_text);
  v_action constant text := v_kw ->> 'action';
  v_identity integrations.whatsapp_identities;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  if v_kw is null then
    return jsonb_build_object('action', null);
  end if;
  insert into integrations.whatsapp_identities as i (wa_id, preferred_language, consent_status, consent_updated_at)
  values (p_wa_id, v_kw ->> 'language',
          case v_action when 'opt_out' then 'opted_out' when 'opt_in' then 'opted_in' else 'unknown' end,
          case when v_action <> 'help' then now() end)
  on conflict (wa_id) do update
    set preferred_language = excluded.preferred_language,
        consent_status = case when v_action = 'help' then i.consent_status else excluded.consent_status end,
        consent_updated_at = case when v_action = 'help' then i.consent_updated_at else now() end
  returning * into v_identity;

  if v_identity.user_id is not null and v_action <> 'help' then
    insert into integrations.whatsapp_consents as c (user_id, opted_in, opted_in_at, opted_out_at)
    values (v_identity.user_id, v_action = 'opt_in',
            case when v_action = 'opt_in' then now() end, case when v_action = 'opt_out' then now() end)
    on conflict (user_id) do update
      set opted_in = excluded.opted_in,
          opted_in_at = case when excluded.opted_in then now() else c.opted_in_at end,
          opted_out_at = case when excluded.opted_in then null else now() end;
  end if;
  insert into integrations.whatsapp_consent_events (wa_id, user_id, action, source, keyword, inbound_message_id)
  values (p_wa_id, v_identity.user_id, v_action, 'keyword', v_kw ->> 'keyword',
          (select m.id from integrations.whatsapp_inbound_messages m where m.id = p_record_id));
  return jsonb_build_object('action', v_action, 'language', v_kw ->> 'language',
                            'consent_status', v_identity.consent_status);
end;
$$;
comment on function public.api_whatsapp_handle_keyword(text, text, uuid) is
  'Webhook: applies a consent keyword to the number and its member; {action: null} for other text.';

-- Who may use the personal bot (D143: Pro only). An unlinked number or a member without Pro
-- gets `upsell = true` at most once per 24 hours; an inactive member gets nothing.
create function public.api_whatsapp_bot_access(p_wa_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_access text;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  select i.user_id into v_user from integrations.whatsapp_identities i where i.wa_id = p_wa_id;
  v_access := case
    when v_user is null then 'unlinked'
    when not exists (select 1 from public.users u where u.id = v_user and u.is_active) then 'inactive'
    when kc_private.is_pro(v_user) then 'pro'
    else 'not_pro' end;
  if v_access in ('pro', 'inactive') then
    return jsonb_build_object('access', v_access, 'user_id', v_user, 'upsell', false);
  end if;
  update integrations.whatsapp_identities i
     set last_upsell_at = now()
   where i.wa_id = p_wa_id and (i.last_upsell_at is null or i.last_upsell_at < now() - interval '24 hours');
  return jsonb_build_object('access', v_access, 'user_id', v_user, 'upsell', found);
end;
$$;
comment on function public.api_whatsapp_bot_access(text) is
  'Webhook: pro | unlinked | not_pro | inactive for a number, and whether to send the upsell now.';

-- Takes one unit of the language-model budget: per number and global, per day.
create function public.api_whatsapp_llm_budget_take(p_wa_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits constant integrations.whatsapp_send_limits := kc_private.whatsapp_limits();
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  if not kc_private.rate_limit('wa_llm:' || p_wa_id, v_limits.llm_per_phone_day, interval '1 day') then
    return false;
  end if;
  return kc_private.rate_limit('wa_llm_global', v_limits.llm_global_day, interval '1 day');
end;
$$;
comment on function public.api_whatsapp_llm_budget_take(text) is 'Agent: takes one language-model call from the per-number and global daily budget.';

-- ── Outbound: queueing ──────────────────────────────────────────────────────
-- Queues a free-form reply inside the number's 24-hour window. After a STOP only the STOP
-- confirmation passes. Returns the outbound row id; the outcome is its status.
create function public.api_whatsapp_queue_reply(p_wa_id text, p_body text, p_reply_kind text default 'reply')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity integrations.whatsapp_identities;
  v_status text;
  v_id uuid;
begin
  if p_reply_kind is null or p_reply_kind not in ('reply', 'consent_confirmation', 'help') then
    raise exception 'invalid_reply_kind' using errcode = 'P0001';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'body_required' using errcode = 'P0001';
  end if;
  if char_length(p_body) > 4096 then
    raise exception 'body_too_long' using errcode = 'P0001';
  end if;
  select i.* into v_identity from integrations.whatsapp_identities i where i.wa_id = p_wa_id;
  v_status := case
    when not kc_private.whatsapp_channel_enabled() then 'skipped_channel_disabled'
    when v_identity.id is null then 'skipped_no_identity'
    when v_identity.last_inbound_at is null or v_identity.last_inbound_at < now() - interval '24 hours'
      then 'skipped_outside_window'
    when v_identity.consent_status = 'opted_out' and p_reply_kind <> 'consent_confirmation' then 'skipped_no_consent'
    when not kc_private.rate_limit('wa_reply:' || p_wa_id, (kc_private.whatsapp_limits()).reply_per_phone_hour,
                                   interval '1 hour') then 'skipped_rate_limit'
    else 'queued' end;
  insert into integrations.whatsapp_outbound_messages (user_id, kind, to_wa_id, language, body, payload, status)
  values (v_identity.user_id, 'session', p_wa_id, coalesce(v_identity.preferred_language, 'he'), p_body,
          jsonb_build_object('reply_kind', p_reply_kind), v_status)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.api_whatsapp_queue_reply(text, text, text) is
  'Webhook / agent: queues a session reply inside the 24-hour window; the outcome is the row status.';

-- Queues a proactive template message to a member (see the header for the gate order).
-- Returns the outbound row id.
create function kc_private.whatsapp_queue_template(p_user_id uuid, p_template text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits constant integrations.whatsapp_send_limits := kc_private.whatsapp_limits();
  v_identity integrations.whatsapp_identities;
  v_lang text;
  v_status text;
  v_hour integer;
  v_day integer;
  v_recipients integer;
  v_id uuid;
begin
  select i.* into v_identity from integrations.whatsapp_identities i
   where i.user_id = p_user_id order by i.last_inbound_at desc nulls last, i.updated_at desc limit 1;
  select t.language_code into v_lang from integrations.whatsapp_message_templates t
   where t.template_name = p_template and t.is_approved
   order by (t.language_code = coalesce(v_identity.preferred_language, 'he')) desc, (t.language_code = 'he') desc
   limit 1;
  select count(*) filter (where o.created_at > now() - interval '1 hour'), count(*)
    into v_hour, v_day
    from integrations.whatsapp_outbound_messages o
   where o.user_id = p_user_id and o.kind = 'template' and o.status in ('queued', 'sending', 'sent')
     and o.created_at > now() - interval '24 hours';
  select count(distinct o.to_wa_id) into v_recipients
    from integrations.whatsapp_outbound_messages o
   where o.kind = 'template' and o.status in ('queued', 'sending', 'sent')
     and o.created_at > now() - interval '24 hours' and o.to_wa_id is distinct from v_identity.wa_id;

  v_status := case
    when not kc_private.whatsapp_channel_enabled() then 'skipped_channel_disabled'
    when not kc_private.whatsapp_user_can_receive(p_user_id) then 'skipped_no_consent'
    when v_identity.id is null then 'skipped_no_identity'
    when v_lang is null then 'skipped_template_unapproved'
    when v_hour >= v_limits.per_user_hour or v_day >= v_limits.per_user_day then 'skipped_rate_limit'
    when v_recipients >= v_limits.global_template_recipients_day then 'skipped_global_cap'
    else 'queued' end;
  insert into integrations.whatsapp_outbound_messages (user_id, kind, to_wa_id, language, template_name, payload, status)
  values (p_user_id, 'template', v_identity.wa_id, coalesce(v_lang, v_identity.preferred_language, 'he'),
          p_template, coalesce(p_payload, '{}'::jsonb), v_status)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function kc_private.whatsapp_queue_template(uuid, text, jsonb) is
  'Queues a proactive WhatsApp template to a member through every gate; returns the outbound id.';

-- ── Sender contract ─────────────────────────────────────────────────────────
-- The channel settings the sender needs (it cannot read `integrations` through the API).
create function public.api_whatsapp_channel_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('is_enabled', c.is_enabled, 'phone_number_id', c.phone_number_id,
                                             'graph_api_version', c.graph_api_version)
                     from integrations.whatsapp_channel_config c where c.id),
                  jsonb_build_object('is_enabled', false, 'phone_number_id', null, 'graph_api_version', null));
$$;
comment on function public.api_whatsapp_channel_config() is 'Sender: {is_enabled, phone_number_id, graph_api_version}.';

-- Claims due messages for sending, within the global per-minute budget: queued rows whose
-- time has come and `sending` rows whose claim is older than p_visibility_seconds. A
-- template whose member withdrew consent meanwhile becomes skipped_no_consent. Nothing is
-- claimed while the channel is off.
create function public.api_whatsapp_outbound_claim(p_batch integer default 20, p_visibility_seconds integer default 60)
returns table (
  outbound_id uuid, user_id uuid, kind text, to_wa_id text, language text, template_name text,
  body text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_per_minute constant integer := (kc_private.whatsapp_limits()).global_per_minute;
  v_visibility constant interval := make_interval(secs => greatest(coalesce(p_visibility_seconds, 60), 1));
  v_budget integer;
  v_row integrations.whatsapp_outbound_messages;
begin
  if not kc_private.whatsapp_channel_enabled() then
    return;
  end if;
  v_budget := least(least(greatest(coalesce(p_batch, 20), 1), 100),
                    v_per_minute - kc_private.rate_limit_peek('wa_out_global'));
  if v_budget <= 0 then
    return;
  end if;
  for v_row in
    update integrations.whatsapp_outbound_messages o
       set status = 'sending', claimed_at = now()
     where o.id in (select q.id from integrations.whatsapp_outbound_messages q
                     where (q.status = 'queued' and q.next_attempt_at <= now())
                        or (q.status = 'sending' and q.claimed_at < now() - v_visibility)
                     order by q.next_attempt_at, q.id
                     limit v_budget
                       for update skip locked)
    returning o.*
  loop
    if v_row.kind = 'template' and not kc_private.whatsapp_user_can_receive(v_row.user_id) then
      update integrations.whatsapp_outbound_messages o
         set status = 'skipped_no_consent', claimed_at = null
       where o.id = v_row.id;
      continue;
    end if;
    perform kc_private.rate_limit('wa_out_global', v_per_minute, interval '1 minute');
    outbound_id := v_row.id; user_id := v_row.user_id; kind := v_row.kind; to_wa_id := v_row.to_wa_id;
    language := v_row.language; template_name := v_row.template_name; body := v_row.body;
    payload := v_row.payload; attempts := v_row.attempts;
    return next;
  end loop;
end;
$$;
comment on function public.api_whatsapp_outbound_claim(integer, integer) is
  'Sender: claims due outbound messages within the global per-minute budget.';

-- Reports a send: sent; or, when retryable and attempts remain, queued again after an
-- exponential backoff (base · 2^attempts, at most an hour); otherwise failed. A row that is
-- no longer `sending` is left as it is and its status returned.
create function public.api_whatsapp_outbound_result(
  p_outbound_id uuid, p_ok boolean, p_wa_message_id text default null,
  p_error text default null, p_retryable boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits constant integrations.whatsapp_send_limits := kc_private.whatsapp_limits();
  v_row integrations.whatsapp_outbound_messages;
  v_backoff integer;
begin
  select o.* into v_row from integrations.whatsapp_outbound_messages o where o.id = p_outbound_id for update;
  if not found then
    raise exception 'outbound_not_found' using errcode = 'P0001';
  end if;
  if v_row.status <> 'sending' then
    return v_row.status;
  end if;
  if coalesce(p_ok, false) then
    update integrations.whatsapp_outbound_messages o
       set status = 'sent', sent_at = now(), wa_message_id = left(p_wa_message_id, 200), last_error = null
     where o.id = p_outbound_id;
    return 'sent';
  end if;
  if coalesce(p_retryable, false) and v_row.attempts + 1 < v_limits.max_attempts then
    v_backoff := least(v_limits.backoff_base_seconds * power(2, v_row.attempts)::integer, 3600);
    update integrations.whatsapp_outbound_messages o
       set status = 'queued', attempts = o.attempts + 1, claimed_at = null,
           next_attempt_at = now() + make_interval(secs => v_backoff), last_error = left(p_error, 500)
     where o.id = p_outbound_id;
    return 'queued';
  end if;
  update integrations.whatsapp_outbound_messages o
     set status = 'failed', attempts = o.attempts + 1, last_error = left(p_error, 500)
   where o.id = p_outbound_id;
  return 'failed';
end;
$$;
comment on function public.api_whatsapp_outbound_result(uuid, boolean, text, text, boolean) is
  'Sender: records a send result with retry and exponential backoff; returns the new status.';
