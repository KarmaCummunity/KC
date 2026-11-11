-- 0306_whatsapp_rate_limits_queue | Issue #938
-- Per-user / per-phone / global caps, the 24h session-window rule, LLM budget and an
-- outbound backoff queue (pgmq when installed, table polling otherwise).
--
--   * whatsapp_send_limits: single-row config (Meta tier defaults; operators tune it).
--   * whatsapp_rate_counters + whatsapp_rate_take(): fixed-window counters.
--   * api_whatsapp_inbound_allowed(wa_id): inbound throttle per phone.
--   * api_whatsapp_llm_budget_take(wa_id): per-phone + global daily LLM budget.
--   * api_whatsapp_queue_outbound (redefined): consent → identity → approved template →
--     per-user hour/day caps → global daily unique-recipient tier cap → queued + pgmq.
--   * api_whatsapp_queue_reply(wa_id, body, reply_kind): free-form session reply, only
--     inside the 24h customer-service window. After STOP only the STOP confirmation passes.
--   * api_whatsapp_outbound_claim / api_whatsapp_outbound_result: sender worker contract.
--     Global per-minute cap at claim time; consent rechecked at claim; exponential backoff
--     (pgmq.set_vt or next_attempt_at); archive after max attempts.

begin;

-- Config ----------------------------------------------------------------------------
create table if not exists public.whatsapp_send_limits (
  id                              boolean primary key default true check (id),
  per_user_hour                   int not null default 5   check (per_user_hour > 0),
  per_user_day                    int not null default 20  check (per_user_day > 0),
  reply_per_phone_hour            int not null default 30  check (reply_per_phone_hour > 0),
  global_per_minute               int not null default 60  check (global_per_minute > 0),
  global_template_recipients_day  int not null default 1000 check (global_template_recipients_day > 0),
  inbound_per_phone_minute        int not null default 20  check (inbound_per_phone_minute > 0),
  llm_per_phone_day               int not null default 30  check (llm_per_phone_day > 0),
  llm_global_day                  int not null default 2000 check (llm_global_day > 0),
  max_attempts                    int not null default 5   check (max_attempts between 1 and 20),
  backoff_base_seconds            int not null default 30  check (backoff_base_seconds > 0),
  updated_at                      timestamptz not null default now()
);

insert into public.whatsapp_send_limits (id) values (true) on conflict (id) do nothing;

alter table public.whatsapp_send_limits enable row level security;
revoke all on public.whatsapp_send_limits from anon, authenticated;
grant select on public.whatsapp_send_limits to authenticated;
create policy whatsapp_send_limits_operator_read on public.whatsapp_send_limits
  for select to authenticated using (public.is_listing_operator(auth.uid()));
create policy whatsapp_send_limits_service_all on public.whatsapp_send_limits
  for all to service_role using (true) with check (true);

-- Fixed-window counters ----------------------------------------------------------------
create table if not exists public.whatsapp_rate_counters (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, window_start)
);

alter table public.whatsapp_rate_counters enable row level security;
revoke all on public.whatsapp_rate_counters from anon, authenticated;
create policy whatsapp_rate_counters_service_all on public.whatsapp_rate_counters
  for all to service_role using (true) with check (true);

create or replace function public.whatsapp_rate_window(p_window_seconds int)
returns timestamptz
language sql
stable
as $$
  select to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
$$;

-- Atomically counts one hit; true while the window is still within p_limit.
create or replace function public.whatsapp_rate_take(p_bucket text, p_window_seconds int, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into public.whatsapp_rate_counters (bucket, window_start, hits)
  values (p_bucket, public.whatsapp_rate_window(p_window_seconds), 1)
  on conflict (bucket, window_start) do update set hits = whatsapp_rate_counters.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

create or replace function public.whatsapp_rate_peek(p_bucket text, p_window_seconds int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select hits from public.whatsapp_rate_counters
     where bucket = p_bucket and window_start = public.whatsapp_rate_window(p_window_seconds)
  ), 0);
$$;

create or replace function public.api_whatsapp_rate_counters_prune(p_older_than interval default interval '3 days')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.whatsapp_rate_counters where window_start < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Inbound throttle + LLM budget ----------------------------------------------------------
create or replace function public.api_whatsapp_inbound_allowed(p_wa_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
begin
  select * into v_lim from public.whatsapp_send_limits where id;
  return public.whatsapp_rate_take('in:' || p_wa_id, 60, v_lim.inbound_per_phone_minute);
end;
$$;

create or replace function public.api_whatsapp_llm_budget_take(p_wa_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
begin
  select * into v_lim from public.whatsapp_send_limits where id;
  if not public.whatsapp_rate_take('llm:' || p_wa_id, 86400, v_lim.llm_per_phone_day) then
    return false;
  end if;
  return public.whatsapp_rate_take('llm:global', 86400, v_lim.llm_global_day);
end;
$$;

-- Outbound table: queue columns + statuses --------------------------------------------------
alter table public.bot_outbound_messages
  add column if not exists kind            text not null default 'template'
    check (kind in ('template', 'session')),
  add column if not exists to_wa_id        text,
  add column if not exists language        text not null default 'he',
  add column if not exists body            text,
  add column if not exists attempts        int not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists claimed_at      timestamptz,
  add column if not exists sent_at         timestamptz,
  add column if not exists wa_message_id   text,
  add column if not exists last_error      text,
  add column if not exists queue_msg_id    bigint;

alter table public.bot_outbound_messages drop constraint if exists bot_outbound_messages_status_check;
alter table public.bot_outbound_messages add constraint bot_outbound_messages_status_check
  check (status in (
    'queued', 'sending', 'sent', 'failed',
    'skipped_rate_limit', 'skipped_no_consent', 'skipped_outside_window',
    'skipped_template_unapproved', 'skipped_no_identity', 'skipped_global_cap'
  ));

create index if not exists bot_outbound_messages_due_idx
  on public.bot_outbound_messages (next_attempt_at)
  where status = 'queued';
create index if not exists bot_outbound_messages_to_wa_created_idx
  on public.bot_outbound_messages (to_wa_id, created_at desc);

-- pgmq queue (optional) ----------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pgmq') then
    begin
      perform pgmq.create('whatsapp_outbound');
    exception
      when duplicate_object or duplicate_table then null;
      when others then raise notice 'pgmq queue whatsapp_outbound not created: %', sqlerrm;
    end;
  end if;
end $$;

create or replace function public.whatsapp_pgmq_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from pg_extension where extname = 'pgmq')
     and to_regclass('pgmq.q_whatsapp_outbound') is not null;
$$;

create or replace function public.whatsapp_outbound_enqueue(p_outbound_id uuid, p_delay_seconds int default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg bigint;
begin
  if public.whatsapp_pgmq_enabled() then
    select pgmq.send('whatsapp_outbound', jsonb_build_object('outbound_id', p_outbound_id), greatest(p_delay_seconds, 0))
      into v_msg;
    update public.bot_outbound_messages set queue_msg_id = v_msg where outbound_id = p_outbound_id;
  end if;
end;
$$;

-- Queue a proactive (template) message ---------------------------------------------------------
create or replace function public.api_whatsapp_queue_outbound(
  p_user_id uuid,
  p_template_name text,
  p_payload jsonb,
  p_max_per_hour int default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
  v_identity public.whatsapp_identities;
  v_status text;
  v_hour int;
  v_day int;
  v_recipients int;
  v_id uuid;
begin
  select * into v_lim from public.whatsapp_send_limits where id;

  select * into v_identity
    from public.whatsapp_identities
   where user_id = p_user_id
   order by last_inbound_at desc nulls last, updated_at desc
   limit 1;

  if not public.whatsapp_user_can_receive(p_user_id) then
    v_status := 'skipped_no_consent';
  elsif v_identity.identity_id is null then
    v_status := 'skipped_no_identity';
  elsif not exists (
    select 1 from public.whatsapp_message_templates t
     where t.template_name = p_template_name and t.is_approved
  ) then
    v_status := 'skipped_template_unapproved';
  else
    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*)
      into v_hour, v_day
      from public.bot_outbound_messages
     where user_id = p_user_id
       and kind = 'template'
       and status in ('queued', 'sending', 'sent')
       and created_at > now() - interval '24 hours';

    select count(distinct to_wa_id) into v_recipients
      from public.bot_outbound_messages
     where kind = 'template'
       and status in ('queued', 'sending', 'sent')
       and created_at > now() - interval '24 hours'
       and to_wa_id is distinct from v_identity.wa_id;

    -- p_max_per_hour (legacy arg, default 5) can only tighten the configured cap.
    if v_hour >= greatest(least(coalesce(p_max_per_hour, v_lim.per_user_hour), v_lim.per_user_hour), 1)
       or v_day >= v_lim.per_user_day then
      v_status := 'skipped_rate_limit';
    elsif v_recipients >= v_lim.global_template_recipients_day then
      v_status := 'skipped_global_cap';
    else
      v_status := 'queued';
    end if;
  end if;

  insert into public.bot_outbound_messages (
    user_id, kind, to_wa_id, language, template_name, payload, status
  ) values (
    p_user_id, 'template', v_identity.wa_id, coalesce(v_identity.preferred_language, 'he'),
    p_template_name, coalesce(p_payload, '{}'::jsonb), v_status
  )
  returning outbound_id into v_id;

  if v_status = 'queued' then
    perform public.whatsapp_outbound_enqueue(v_id);
  end if;
  return v_id;
end;
$$;

-- Queue a free-form session reply ---------------------------------------------------------------
create or replace function public.api_whatsapp_queue_reply(
  p_wa_id text,
  p_body text,
  p_reply_kind text default 'reply'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
  v_identity public.whatsapp_identities;
  v_status text;
  v_id uuid;
begin
  if p_reply_kind not in ('reply', 'consent_confirmation', 'help') then
    raise exception 'invalid_reply_kind' using errcode = '22023';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'body_required' using errcode = '22023';
  end if;

  select * into v_lim from public.whatsapp_send_limits where id;
  select * into v_identity from public.whatsapp_identities where wa_id = p_wa_id;

  if v_identity.identity_id is null then
    v_status := 'skipped_no_identity';
  elsif v_identity.last_inbound_at is null or v_identity.last_inbound_at < now() - interval '24 hours' then
    v_status := 'skipped_outside_window';
  elsif v_identity.consent_status = 'opted_out' and p_reply_kind <> 'consent_confirmation' then
    v_status := 'skipped_no_consent';
  elsif not public.whatsapp_rate_take('reply:' || p_wa_id, 3600, v_lim.reply_per_phone_hour) then
    v_status := 'skipped_rate_limit';
  else
    v_status := 'queued';
  end if;

  insert into public.bot_outbound_messages (
    user_id, kind, to_wa_id, language, body, payload, status
  ) values (
    v_identity.user_id, 'session', p_wa_id, coalesce(v_identity.preferred_language, 'he'),
    p_body, jsonb_build_object('reply_kind', p_reply_kind), v_status
  )
  returning outbound_id into v_id;

  if v_status = 'queued' then
    perform public.whatsapp_outbound_enqueue(v_id);
  end if;
  return v_id;
end;
$$;

-- Sender contract: claim -----------------------------------------------------------------------
create or replace function public.api_whatsapp_outbound_claim(
  p_batch int default 20,
  p_visibility_seconds int default 60
)
returns setof public.bot_outbound_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
  v_budget int;
  v_row public.bot_outbound_messages;
  v_msg record;
  v_claimed int := 0;
  v_ok boolean;
begin
  select * into v_lim from public.whatsapp_send_limits where id;
  v_budget := least(
    greatest(coalesce(p_batch, 20), 1),
    v_lim.global_per_minute - public.whatsapp_rate_peek('out:global', 60)
  );
  if v_budget <= 0 then
    return;
  end if;

  if public.whatsapp_pgmq_enabled() then
    for v_msg in select * from pgmq.read('whatsapp_outbound', p_visibility_seconds, v_budget) loop
      update public.bot_outbound_messages b
         set status = 'sending', claimed_at = now(), queue_msg_id = v_msg.msg_id
       where b.outbound_id = (v_msg.message->>'outbound_id')::uuid
         and (b.status = 'queued'
              or (b.status = 'sending' and b.claimed_at < now() - make_interval(secs => p_visibility_seconds)))
      returning * into v_row;
      if not found then
        perform pgmq.delete('whatsapp_outbound', v_msg.msg_id);  -- stale / already final
        continue;
      end if;
      v_ok := v_row.kind <> 'template' or public.whatsapp_user_can_receive(v_row.user_id);
      if not v_ok then
        update public.bot_outbound_messages set status = 'skipped_no_consent' where outbound_id = v_row.outbound_id;
        perform pgmq.delete('whatsapp_outbound', v_msg.msg_id);
        continue;
      end if;
      v_claimed := v_claimed + 1;
      return next v_row;
    end loop;
  else
    for v_row in
      update public.bot_outbound_messages b
         set status = 'sending', claimed_at = now()
       where b.outbound_id in (
         select outbound_id from public.bot_outbound_messages
          where (status = 'queued' and next_attempt_at <= now())
             or (status = 'sending' and claimed_at < now() - make_interval(secs => p_visibility_seconds))
          order by next_attempt_at
          limit v_budget
          for update skip locked
       )
      returning b.*
    loop
      if v_row.kind = 'template' and not public.whatsapp_user_can_receive(v_row.user_id) then
        update public.bot_outbound_messages set status = 'skipped_no_consent' where outbound_id = v_row.outbound_id;
        continue;
      end if;
      v_claimed := v_claimed + 1;
      return next v_row;
    end loop;
  end if;

  if v_claimed > 0 then
    insert into public.whatsapp_rate_counters (bucket, window_start, hits)
    values ('out:global', public.whatsapp_rate_window(60), v_claimed)
    on conflict (bucket, window_start) do update set hits = whatsapp_rate_counters.hits + v_claimed;
  end if;
end;
$$;

-- Sender contract: result ------------------------------------------------------------------------
create or replace function public.api_whatsapp_outbound_result(
  p_outbound_id uuid,
  p_ok boolean,
  p_wa_message_id text default null,
  p_error text default null,
  p_retryable boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
  v_row public.bot_outbound_messages;
  v_backoff int;
  v_pgmq boolean := public.whatsapp_pgmq_enabled();
begin
  select * into v_lim from public.whatsapp_send_limits where id;
  select * into v_row from public.bot_outbound_messages where outbound_id = p_outbound_id for update;
  if not found then
    raise exception 'outbound_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'sending' then
    return v_row.status;  -- idempotent: already finalised
  end if;

  if p_ok then
    update public.bot_outbound_messages
       set status = 'sent', sent_at = now(), wa_message_id = p_wa_message_id, last_error = null
     where outbound_id = p_outbound_id;
    if v_pgmq and v_row.queue_msg_id is not null then
      perform pgmq.delete('whatsapp_outbound', v_row.queue_msg_id);
    end if;
    return 'sent';
  end if;

  if p_retryable and v_row.attempts + 1 < v_lim.max_attempts then
    v_backoff := least(v_lim.backoff_base_seconds * power(2, v_row.attempts)::int, 3600);
    update public.bot_outbound_messages
       set status = 'queued',
           attempts = attempts + 1,
           next_attempt_at = now() + make_interval(secs => v_backoff),
           claimed_at = null,
           last_error = left(p_error, 500)
     where outbound_id = p_outbound_id;
    if v_pgmq and v_row.queue_msg_id is not null then
      perform pgmq.set_vt('whatsapp_outbound', v_row.queue_msg_id, v_backoff);
    end if;
    return 'queued';
  end if;

  update public.bot_outbound_messages
     set status = 'failed', attempts = attempts + 1, last_error = left(p_error, 500)
   where outbound_id = p_outbound_id;
  if v_pgmq and v_row.queue_msg_id is not null then
    perform pgmq.archive('whatsapp_outbound', v_row.queue_msg_id);
  end if;
  return 'failed';
end;
$$;

revoke all on function public.whatsapp_rate_take(text, int, int) from public;
revoke all on function public.whatsapp_rate_peek(text, int) from public;
revoke all on function public.whatsapp_outbound_enqueue(uuid, int) from public;
revoke all on function public.whatsapp_pgmq_enabled() from public;
revoke all on function public.api_whatsapp_rate_counters_prune(interval) from public;
revoke all on function public.api_whatsapp_inbound_allowed(text) from public;
revoke all on function public.api_whatsapp_llm_budget_take(text) from public;
revoke all on function public.api_whatsapp_queue_reply(text, text, text) from public;
revoke all on function public.api_whatsapp_outbound_claim(int, int) from public;
revoke all on function public.api_whatsapp_outbound_result(uuid, boolean, text, text, boolean) from public;
revoke all on function public.api_whatsapp_queue_outbound(uuid, text, jsonb, int) from public;

grant execute on function public.api_whatsapp_rate_counters_prune(interval) to service_role;
grant execute on function public.api_whatsapp_inbound_allowed(text) to service_role;
grant execute on function public.api_whatsapp_llm_budget_take(text) to service_role;
grant execute on function public.api_whatsapp_queue_reply(text, text, text) to service_role;
grant execute on function public.api_whatsapp_outbound_claim(int, int) to service_role;
grant execute on function public.api_whatsapp_outbound_result(uuid, boolean, text, text, boolean) to service_role;
grant execute on function public.api_whatsapp_queue_outbound(uuid, text, jsonb, int) to service_role;

commit;
