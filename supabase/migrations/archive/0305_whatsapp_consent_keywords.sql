-- 0305_whatsapp_consent_keywords | Issue #937
-- Phone-level opt-in / opt-out (STOP / START / HELP in he + en), consent audit trail,
-- 24h session tracking. #845 (0303) only had per-user match consent.
--
--   * whatsapp_identities gets consent state + last_inbound_at (24h customer-service window).
--   * whatsapp_consent_events: append-only audit of every consent change / HELP request.
--   * whatsapp_parse_keyword(text): exact-match keyword parser (he/en, case/punctuation
--     insensitive). Ordinary messages that merely *contain* "stop" are NOT keywords.
--   * api_whatsapp_handle_keyword(wa_id, text, record_id): applies the keyword, audits it,
--     mirrors opt-out/in into whatsapp_match_consent for the linked user, and returns
--     {action, language} so the edge function can send the confirmation reply.
--   * api_bot_set_match_consent now also audits (source 'app').
--   * whatsapp_user_can_receive(user_id): proactive-send consent gate used by 0306.
--   * api_whatsapp_ingest_inbound now stamps last_inbound_at from message.from.

begin;

alter table public.whatsapp_identities
  add column if not exists consent_status text not null default 'unknown'
    check (consent_status in ('unknown', 'opted_in', 'opted_out')),
  add column if not exists consent_updated_at timestamptz,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists preferred_language text not null default 'he'
    check (preferred_language in ('he', 'en'));

create index if not exists whatsapp_identities_user_idx
  on public.whatsapp_identities (user_id) where user_id is not null;

create table if not exists public.whatsapp_consent_events (
  event_id    uuid primary key default gen_random_uuid(),
  wa_id       text,
  user_id     uuid references public.users(user_id) on delete set null,
  action      text not null check (action in ('opt_in', 'opt_out', 'help')),
  source      text not null check (source in ('keyword', 'app', 'admin', 'system')),
  keyword     text,
  record_id   uuid references public.raw_records(record_id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists whatsapp_consent_events_wa_idx
  on public.whatsapp_consent_events (wa_id, created_at desc);
create index if not exists whatsapp_consent_events_user_idx
  on public.whatsapp_consent_events (user_id, created_at desc);

alter table public.whatsapp_consent_events enable row level security;
revoke all on public.whatsapp_consent_events from anon, authenticated;
grant select on public.whatsapp_consent_events to authenticated;
create policy whatsapp_consent_events_own on public.whatsapp_consent_events
  for select to authenticated using (user_id = auth.uid());
create policy whatsapp_consent_events_service_all on public.whatsapp_consent_events
  for all to service_role using (true) with check (true);

-- Keyword parser ------------------------------------------------------------------
create or replace function public.whatsapp_parse_keyword(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;
  -- lowercase, drop punctuation/emoji, collapse whitespace
  -- (explicit ranges, not [:alnum:], so Hebrew survives under a C collation/ctype)
  v := regexp_replace(p_text, '[[:punct:]\u05BE\u05F3\u05F4\u2000-\u2BFF\uFE0F]', '', 'g');
  v := regexp_replace(v, '[\U0001F000-\U0001FAFF]', '', 'g');
  v := lower(btrim(regexp_replace(v, '\s+', ' ', 'g')));
  if v = '' or length(v) > 24 then
    return null;
  end if;

  if v in ('stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'opt out', 'optout') then
    return jsonb_build_object('action', 'opt_out', 'language', 'en', 'keyword', v);
  elsif v in ('הסר', 'הסרה', 'הסירו', 'עצור', 'די', 'ביטול', 'הפסק') then
    return jsonb_build_object('action', 'opt_out', 'language', 'he', 'keyword', v);
  elsif v in ('start', 'subscribe', 'yes', 'unstop', 'opt in', 'optin') then
    return jsonb_build_object('action', 'opt_in', 'language', 'en', 'keyword', v);
  elsif v in ('הצטרף', 'הצטרפות', 'התחל', 'כן', 'אישור', 'הרשמה') then
    return jsonb_build_object('action', 'opt_in', 'language', 'he', 'keyword', v);
  elsif v in ('help', 'info') then
    return jsonb_build_object('action', 'help', 'language', 'en', 'keyword', v);
  elsif v in ('עזרה', 'מידע') then
    return jsonb_build_object('action', 'help', 'language', 'he', 'keyword', v);
  end if;
  return null;
end;
$$;

grant execute on function public.whatsapp_parse_keyword(text) to service_role;

-- Apply a keyword ------------------------------------------------------------------
create or replace function public.api_whatsapp_handle_keyword(
  p_wa_id text,
  p_text text,
  p_record_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kw jsonb;
  v_action text;
  v_lang text;
  v_identity public.whatsapp_identities;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = '22023';
  end if;

  v_kw := public.whatsapp_parse_keyword(p_text);
  if v_kw is null then
    return jsonb_build_object('action', null);
  end if;
  v_action := v_kw->>'action';
  v_lang := v_kw->>'language';

  insert into public.whatsapp_identities (wa_id) values (p_wa_id)
  on conflict (wa_id) do nothing;

  update public.whatsapp_identities
     set preferred_language = v_lang,
         consent_status = case v_action
                            when 'opt_out' then 'opted_out'
                            when 'opt_in' then 'opted_in'
                            else consent_status end,
         consent_updated_at = case when v_action in ('opt_out', 'opt_in') then now() else consent_updated_at end,
         updated_at = now()
   where wa_id = p_wa_id
  returning * into v_identity;

  if v_identity.user_id is not null and v_action in ('opt_out', 'opt_in') then
    insert into public.whatsapp_match_consent (user_id, opted_in, opted_in_at, opted_out_at)
    values (
      v_identity.user_id,
      v_action = 'opt_in',
      case when v_action = 'opt_in' then now() end,
      case when v_action = 'opt_out' then now() end
    )
    on conflict (user_id) do update
      set opted_in = excluded.opted_in,
          opted_in_at = case when excluded.opted_in then now() else whatsapp_match_consent.opted_in_at end,
          opted_out_at = case when not excluded.opted_in then now() else null end,
          updated_at = now();
  end if;

  insert into public.whatsapp_consent_events (wa_id, user_id, action, source, keyword, record_id)
  values (p_wa_id, v_identity.user_id, v_action, 'keyword', v_kw->>'keyword', p_record_id);

  return jsonb_build_object(
    'action', v_action,
    'language', v_lang,
    'consent_status', v_identity.consent_status
  );
end;
$$;

grant execute on function public.api_whatsapp_handle_keyword(text, text, uuid) to service_role;

-- App-side consent toggle now audited ------------------------------------------------
create or replace function public.api_bot_set_match_consent(
  p_user_id uuid,
  p_opted_in boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;

  insert into public.whatsapp_match_consent (user_id, opted_in, opted_in_at, opted_out_at)
  values (
    p_user_id,
    p_opted_in,
    case when p_opted_in then now() else null end,
    case when not p_opted_in then now() else null end
  )
  on conflict (user_id) do update
    set opted_in = excluded.opted_in,
        opted_in_at = case when excluded.opted_in then now() else whatsapp_match_consent.opted_in_at end,
        opted_out_at = case when not excluded.opted_in then now() else null end,
        updated_at = now();

  -- An app opt-in never overrides a phone-level STOP; opting out also stops the phone.
  if not p_opted_in then
    update public.whatsapp_identities
       set consent_status = 'opted_out', consent_updated_at = now(), updated_at = now()
     where user_id = p_user_id;
  end if;

  insert into public.whatsapp_consent_events (user_id, action, source)
  values (p_user_id, case when p_opted_in then 'opt_in' else 'opt_out' end, 'app');
end;
$$;

-- Consent gate ----------------------------------------------------------------------
-- Proactive (non-reply) sends need an explicit opt-in row AND no phone-level STOP.
create or replace function public.whatsapp_user_can_receive(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.opted_in from public.whatsapp_match_consent c where c.user_id = p_user_id), false)
     and not exists (
       select 1 from public.whatsapp_identities i
        where i.user_id = p_user_id and i.consent_status = 'opted_out'
     );
$$;

grant execute on function public.whatsapp_user_can_receive(uuid) to service_role;

-- Ingest: stamp last_inbound_at (24h session window) ----------------------------------
create or replace function public.api_whatsapp_ingest_inbound(
  p_message_id text,
  p_payload jsonb,
  p_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
  v_run_id uuid;
  v_key text;
  v_record_id uuid;
  v_from text;
begin
  if p_message_id is null or btrim(p_message_id) = '' then
    raise exception 'message_id_required' using errcode = '22023';
  end if;

  select source_id into v_source_id from public.ingestion_sources where slug = 'whatsapp-cloud';
  if v_source_id is null then
    raise exception 'whatsapp_source_missing' using errcode = 'P0002';
  end if;

  v_key := 'wa:' || p_message_id;

  select record_id into v_record_id from public.raw_records where external_key = v_key;
  if v_record_id is not null then
    return v_record_id;
  end if;

  if p_run_id is null then
    insert into public.ingestion_runs (source_id, status, finished_at, stats)
    values (v_source_id, 'completed', now(), jsonb_build_object('kind', 'whatsapp_inbound'))
    returning run_id into v_run_id;
  else
    v_run_id := p_run_id;
  end if;

  insert into public.raw_records (run_id, external_key, payload, retain_until)
  values (v_run_id, v_key, p_payload, now() + interval '90 days')
  returning record_id into v_record_id;

  v_from := nullif(btrim(coalesce(p_payload #>> '{message,from}', p_payload ->> 'from')), '');
  if v_from is not null then
    insert into public.whatsapp_identities (wa_id, last_inbound_at)
    values (v_from, now())
    on conflict (wa_id) do update set last_inbound_at = now(), updated_at = now();
  end if;

  return v_record_id;
end;
$$;

commit;
