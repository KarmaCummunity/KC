-- Platform · calling Edge Functions from the database (design §4 "Secrets", §7)
--
-- Four workers are Edge Functions the database starts: the push dispatcher, the account
-- purge, the storage orphan reconciliation and the EXIF strip. The call is an asynchronous
-- HTTP request (pg_net: queued in the transaction, sent by a background worker after
-- commit) authorised with the service-role key, which is read from Supabase Vault at call
-- time. The key is referenced by NAME only; it is never stored in a table, a setting or
-- this file.
--
-- Vault secrets (names):  kc_project_url        e.g. https://<project-ref>.supabase.co
--                         kc_service_role_key   the service-role key of the project
--
-- pg_net and Vault are platform extensions. Where either is absent (a plain PostgreSQL
-- server) or a secret is missing, the call is a no-op that leaves a row in ops.warnings.

-- Whether this database can call out at all.
create function kc_private.edge_invocation_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
  select to_regproc('net.http_post') is not null and to_regclass('vault.decrypted_secrets') is not null;
$$;
comment on function kc_private.edge_invocation_ready() is 'True when pg_net and Vault are both installed.';

-- Queues a POST to an Edge Function and returns the pg_net request id, or null when
-- nothing was queued. Never raises: whatever goes wrong becomes a warning, so neither a
-- scheduled job nor a member's transaction can fail on it. The request leaves after the
-- calling transaction commits; its response lands in pg_net's response table, which the
-- health checks read.
create function kc_private.invoke_edge_function(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  if p_function is null or p_function !~ '^[a-z][a-z0-9-]{1,62}$' then
    perform kc_private.ops_warn('edge_invocation_invalid_name', 'not an Edge Function name');
    return null;
  end if;
  if not kc_private.edge_invocation_ready() then
    perform kc_private.ops_warn('edge_invocation_unavailable',
      'pg_net or Vault is not installed; ' || p_function || ' was not invoked');
    return null;
  end if;

  execute 'select (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1),
                  (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $2)'
     into v_url, v_key
    using 'kc_project_url', 'kc_service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    perform kc_private.ops_warn('edge_invocation_unconfigured',
      'Vault secret kc_project_url or kc_service_role_key is missing; ' || p_function || ' was not invoked');
    return null;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
     into v_request_id
    using rtrim(v_url, '/') || '/functions/v1/' || p_function,
          coalesce(p_body, '{}'::jsonb),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
          30000;
  return v_request_id;
exception when others then
  -- The SQLSTATE only: an error text could quote the request.
  perform kc_private.ops_warn('edge_invocation_failed:' || coalesce(p_function, ''), 'sqlstate ' || sqlstate);
  return null;
end;
$$;
comment on function kc_private.invoke_edge_function(text, jsonb) is
  'Queues an HTTP call to an Edge Function with the Vault service key; a recorded no-op when unavailable. Never raises.';

-- ── Immediate start with a debounce ──────────────────────────────────────────
-- A worker that must start as soon as there is work (push) is "kicked" from the writing
-- transaction, at most once per `debounce`; the scheduled run stays the safety net.
create table kc_private.edge_function_kicks (
  function_name text primary key check (function_name ~ '^[a-z][a-z0-9-]{1,62}$'),
  debounce      interval not null check (debounce >= interval '0'),
  last_kick_at  timestamptz not null default '-infinity'
);
comment on table kc_private.edge_function_kicks is 'Edge Functions that may be started from a transaction, and when each was last started.';
alter table kc_private.edge_function_kicks enable row level security;
alter table kc_private.edge_function_kicks force row level security;
revoke all on kc_private.edge_function_kicks from service_role;

-- The dispatcher loops until its queues are empty, so one start serves a burst.
insert into kc_private.edge_function_kicks (function_name, debounce)
values ('dispatch-notification', interval '2 seconds');

-- Starts the function unless it was started within its debounce period or another
-- transaction is starting it right now. Returns whether a call was queued. It never waits
-- (the row is taken with SKIP LOCKED) and never raises.
create function kc_private.edge_function_kick(p_function text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not kc_private.edge_invocation_ready() then
    return false;
  end if;
  perform 1 from kc_private.edge_function_kicks k
    where k.function_name = p_function and k.last_kick_at <= clock_timestamp() - k.debounce
      for update skip locked;
  if not found then
    return false;
  end if;
  update kc_private.edge_function_kicks k
     set last_kick_at = clock_timestamp()
   where k.function_name = p_function;
  return kc_private.invoke_edge_function(p_function) is not null;
exception when others then
  return false;
end;
$$;
comment on function kc_private.edge_function_kick(text) is
  'Debounced, non-blocking start of an Edge Function from a transaction; never waits or raises.';

-- Push latency (FR-NOTIF-001, chat): a notification event starts the dispatcher at once
-- instead of waiting for the next scheduled minute. Statement-level, so a statement that
-- enqueues a hundred events asks once.
create function kc_private.outbox_events_kick_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted i where i.topic = 'notification' and i.available_at <= now()) then
    perform kc_private.edge_function_kick('dispatch-notification');
  end if;
  return null;
exception when others then
  return null;
end;
$$;
comment on function kc_private.outbox_events_kick_dispatcher() is
  'AFTER INSERT (statement) on the outbox: starts the push dispatcher for new notification events; cannot fail the insert.';

create trigger outbox_events_kick_dispatcher
  after insert on kc_private.outbox_events
  referencing new table as inserted
  for each statement execute function kc_private.outbox_events_kick_dispatcher();

-- The scheduled safety net of the dispatcher: starts it when a push queue has due work.
-- Returns whether a call was queued.
create function kc_private.push_dispatch_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from kc_private.outbox_events e
                  where e.topic in ('notification', 'notification_push', 'notification_push_receipt')
                    and e.processed_at is null and e.available_at <= now()) then
    return false;
  end if;
  return kc_private.invoke_edge_function('dispatch-notification') is not null;
end;
$$;
comment on function kc_private.push_dispatch_tick() is
  'Scheduled every minute: starts the push dispatcher when a notification queue has due events.';
