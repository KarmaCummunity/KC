-- Dispatch recovery: a separate durable per-device queue. Legacy push/receipt topics
-- are held, not adopted. Provider acceptance is not physical delivery. An ambiguous
-- send is held as send_unknown, never automatically resent (Expo has no idempotency key).
create table kc_private.dispatch_jobs (
  id bigint generated always as identity primary key,
  origin_event_id bigint not null,
  notification_id uuid not null,
  recipient_id uuid not null references public.users(id) on delete cascade,
  device_id uuid not null,
  snapshot jsonb not null,
  actor_id uuid references public.users(id) on delete set null,
  provider text not null default 'expo' check (provider = 'expo'),
  phase text not null default 'pending' check (phase in
    ('pending','sending','receipt','provider_accepted','failed','send_unknown','skipped')),
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  lease_scope jsonb,
  attempts integer not null default 0 check (attempts>=0),
  receipt_attempts integer not null default 0 check (receipt_attempts>=0),
  token_hash text,
  ticket_id text,
  accepted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (origin_event_id, device_id, provider),
  check ((lease_id is null) = (lease_until is null)),
  check (phase<>'receipt' or (ticket_id is not null and accepted_at is not null))
);
create index dispatch_jobs_due on kc_private.dispatch_jobs (phase, available_at)
  where phase in ('pending','receipt','sending');
alter table kc_private.dispatch_jobs enable row level security;
alter table kc_private.dispatch_jobs force row level security;
revoke all on kc_private.dispatch_jobs from service_role;
comment on table kc_private.dispatch_jobs is
  'Per-device Expo jobs, immutable origin/notification/recipient/device lineage; unknown sends held, no replay.';

create table kc_private.dispatch_gate (
  singleton boolean primary key default true check (singleton),
  epoch uuid not null default gen_random_uuid(),
  activated_at timestamptz not null default now(),
  note text not null
);
alter table kc_private.dispatch_gate enable row level security;
alter table kc_private.dispatch_gate force row level security;
revoke all on kc_private.dispatch_gate from service_role;
-- No INSERT: installing this migration does not activate anything.

create table kc_private.dispatch_admissions (
  origin_event_id bigint primary key,
  epoch uuid not null
);
alter table kc_private.dispatch_admissions enable row level security;
alter table kc_private.dispatch_admissions force row level security;
revoke all on kc_private.dispatch_admissions from service_role;

create function kc_private.dispatch_activate(p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_epoch uuid;
begin
  if nullif(btrim(p_note), '') is null then raise exception 'release note required'; end if;
  -- Epoch admission, NOT id cutoffs: sequence caches, reserved ids and preassigned ids
  -- cannot smuggle a preactivation event into the new epoch. Wait for old writers.
  lock table kc_private.outbox_events in share row exclusive mode;
  insert into kc_private.dispatch_gate (singleton,note) values (true,p_note)
    on conflict (singleton) do nothing returning epoch into v_epoch;
  if not found then raise exception 'dispatch already active; explicit deactivation required'; end if;
  return v_epoch;
end;
$$;
revoke all on function kc_private.dispatch_activate(text) from service_role;
create function kc_private.dispatch_deactivate()
returns void language sql security definer set search_path = '' as $$ delete from kc_private.dispatch_gate where singleton; $$;
revoke all on function kc_private.dispatch_deactivate() from service_role;

create function kc_private.dispatch_scope_valid(p_scope jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; x jsonb; n integer := 0;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then return false; end if;
  if p_scope = '{"automatic":true}'::jsonb then return true; end if;
  for k,v in select * from jsonb_each(p_scope) loop
    if k not in ('event_ids','recipient_id','device_id','notification_id') or v = 'null'::jsonb then return false; end if;
    if k = 'event_ids' then
      if jsonb_typeof(v) <> 'array' then return false; end if;
      if jsonb_array_length(v) not between 1 and 100 then return false; end if;
      for x in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(x) <> 'number' then return false; end if;
        if (x #>> '{}')::numeric <> floor((x #>> '{}')::numeric)
           or (x #>> '{}')::numeric not between 1 and 9007199254740991 then return false; end if;
      end loop;
    elsif jsonb_typeof(v) <> 'string' or (v #>> '{}') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;
    end if;
    n := n + 1;
  end loop;
  return n > 0;
end;
$$;

-- Every present filter intersects the SAME immutable lineage tuple. Automatic requests
-- resolve the gate epoch at query time, so neither caller-supplied cutoffs nor a queued old
-- HTTP body can reopen a closed gate.
create function kc_private.dispatch_matches(
  p_scope jsonb, p_origin bigint, p_notification uuid, p_recipient uuid, p_device uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if p_scope ? 'automatic' then
    return exists (select 1 from kc_private.dispatch_gate g join kc_private.dispatch_admissions a on a.epoch=g.epoch
      where a.origin_event_id=p_origin);
  end if;
  return (not (p_scope ? 'event_ids') or p_scope -> 'event_ids' @> to_jsonb(p_origin))
    and (not (p_scope ? 'notification_id') or p_notification = (p_scope ->> 'notification_id')::uuid)
    and (not (p_scope ? 'recipient_id') or p_recipient = (p_scope ->> 'recipient_id')::uuid)
    and (not (p_scope ? 'device_id') or p_device = (p_scope ->> 'device_id')::uuid);
end;
$$;

-- Validate the whole explicit event list and ownership before any claim/attempt bump.
-- A well-formed but foreign/mismatched scope is a valid empty result, never a subset.
create function kc_private.dispatch_preflight(p_scope jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; r uuid := (p_scope ->> 'recipient_id')::uuid;
  d uuid := (p_scope ->> 'device_id')::uuid; n uuid := (p_scope ->> 'notification_id')::uuid;
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if p_scope ? 'automatic' then return exists(select 1 from kc_private.dispatch_gate); end if;
  if d is not null and not exists(select 1 from public.user_devices u where u.id=d and (r is null or u.user_id=r)) then return false; end if;
  if n is not null and not exists(select 1 from public.notifications z where z.id=n
    and (r is null or z.user_id=r) and (d is null or exists(select 1 from public.user_devices u where u.id=d and u.user_id=z.user_id))) then return false; end if;
  for x in select value from jsonb_array_elements(coalesce(p_scope -> 'event_ids','[]'::jsonb)) loop
    if not exists(select 1 from (
      select e.id origin,(e.payload ->> 'recipient_id')::uuid recipient from kc_private.outbox_events e where e.topic='notification'
      union select j.origin_event_id,j.recipient_id from kc_private.dispatch_jobs j) e
      where e.origin=(x #>> '{}')::bigint and (r is null or e.recipient=r)
      and (d is null or exists(select 1 from public.user_devices u where u.id=d and u.user_id=e.recipient))
      and (n is null or exists(select 1 from kc_private.dispatch_jobs j where j.origin_event_id=e.origin and j.notification_id=n))) then return false; end if;
  end loop;
  return true;
end;
$$;

-- Linearize closing the gate against claims and POST permission. A snapshot check alone
-- is insufficient: DELETE could otherwise commit between checking and authorising.
-- The lock lasts only for this database transaction, never across the provider request.
create function kc_private.dispatch_lock_gate(p_scope jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if p_scope ? 'automatic' then
    perform 1 from kc_private.dispatch_gate for share;
    return found;
  end if;
  return true;
end;
$$;
