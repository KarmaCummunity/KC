-- 0301_whatsapp_webhook_ingestion | Issue #843
-- Idempotent inbound store + api_whatsapp_ingest_inbound for Edge webhook.

begin;

create unique index if not exists raw_records_whatsapp_message_uidx
  on public.raw_records (external_key)
  where external_key like 'wa:%';

create table if not exists public.bot_outbound_messages (
  outbound_id     uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(user_id) on delete set null,
  channel         text not null default 'whatsapp',
  template_name   text,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'queued'
    check (status in ('queued','sent','failed','skipped_rate_limit','skipped_no_consent')),
  created_at      timestamptz not null default now()
);

create index bot_outbound_messages_user_created_idx
  on public.bot_outbound_messages (user_id, created_at desc);

alter table public.bot_outbound_messages enable row level security;
revoke all on public.bot_outbound_messages from authenticated, anon;
-- Bot-internal queue: only service_role (edge functions) touches it.
create policy bot_outbound_messages_service_all on public.bot_outbound_messages
  for all to service_role using (true) with check (true);

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
  values (
    v_run_id,
    v_key,
    p_payload,
    now() + interval '90 days'
  )
  returning record_id into v_record_id;

  return v_record_id;
end;
$$;

create or replace function public.api_whatsapp_outbound_log(
  p_user_id uuid,
  p_template_name text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.bot_outbound_messages (user_id, channel, template_name, payload, status)
  values (p_user_id, 'whatsapp', p_template_name, p_payload, 'queued')
  returning outbound_id into v_id;
  return v_id;
end;
$$;

grant execute on function public.api_whatsapp_ingest_inbound(text, jsonb, uuid) to service_role;
grant execute on function public.api_whatsapp_outbound_log(uuid, text, jsonb) to service_role;

commit;
