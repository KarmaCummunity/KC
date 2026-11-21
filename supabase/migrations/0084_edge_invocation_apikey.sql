-- Dispatch recovery: generated concatenation of canonical dispatch modules.
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
-- Atomic first delivery: inbox mutation, durable per-device jobs and origin completion
-- commit together. No provider call is made here. The origin row lock is held throughout
-- this single transaction; another worker cannot claim/complete it between these steps.
create function kc_private.dispatch_deliver(p_scope jsonb, p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare e kc_private.outbox_events; r jsonb; t jsonb; n integer := 0; d uuid;
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if not kc_private.dispatch_lock_gate(p_scope) then return 0; end if;
  if not kc_private.dispatch_preflight(p_scope) then return 0; end if;
  d := (p_scope ->> 'device_id')::uuid;
  for e in select o.* from kc_private.outbox_events o
    where o.topic = 'notification' and o.processed_at is null and o.available_at <= now()
      and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
      and kc_private.dispatch_matches(p_scope, o.id, null, (o.payload ->> 'recipient_id')::uuid, d)
      and (d is null or exists (select 1 from public.user_devices u
            where u.id = d and u.user_id = (o.payload ->> 'recipient_id')::uuid))
    order by o.available_at, o.id limit least(greatest(p_limit, 1), 100)
    for update skip locked
  loop
    begin
      update kc_private.outbox_events set attempts = attempts + 1 where id = e.id;
      r := kc_private.notifications_deliver(e.id);
      if r ->> 'status' = 'delivered' and jsonb_typeof(r -> 'push') = 'object' then
        for t in select value from jsonb_array_elements(r -> 'push' -> 'tokens') loop
          -- Expo is native-only. Web transport is a separate, still-unimplemented slice.
          if t ->> 'platform' in ('ios','android') then
            insert into kc_private.dispatch_jobs (origin_event_id, notification_id, recipient_id, device_id, snapshot, actor_id)
              values (e.id, (r ->> 'notification_id')::uuid, (e.payload ->> 'recipient_id')::uuid,
                (t ->> 'device_id')::uuid,
                ((r -> 'push') - 'tokens' - 'badge') || jsonb_build_object('args',coalesce(e.payload -> 'data','{}'::jsonb)),
                (e.payload ->> 'actor_id')::uuid) on conflict (origin_event_id, device_id, provider) do nothing;
          end if;
        end loop;
      end if;
      n := n + 1;
    exception when others then
      -- The inner subtransaction rolls back inbox+job+completion together. No text or
      -- tokens in the diagnostic. Retry the origin later, not an incomplete partial job.
      update kc_private.outbox_events set attempts = attempts + 1, available_at = now() + interval '1 minute',
        last_error = 'dispatch_delivery:' || sqlstate where id = e.id;
    end;
  end loop;
  return n;
end;
$$;

create function kc_private.dispatch_claim(p_scope jsonb, p_phase text, p_limit integer default 50)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare j kc_private.dispatch_jobs; n public.notifications; p jsonb; v_token text; v_expired integer;
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if p_phase not in ('pending','receipt') then raise exception 'invalid dispatch phase'; end if;
  if not kc_private.dispatch_lock_gate(p_scope) then return; end if;
  if not kc_private.dispatch_preflight(p_scope) then return; end if;
  -- A worker that disappeared after obtaining permission to POST may have sent. Hold,
  -- do not resend. This is at-most-one automatic POST attempt for ambiguous sends.
  update kc_private.dispatch_jobs x set phase = 'send_unknown', last_error = 'lease_expired_after_send_start',
      lease_id = null, lease_until = null
    where x.phase = 'sending' and x.lease_until <= now()
      and kc_private.dispatch_matches(p_scope,x.origin_event_id,x.notification_id,x.recipient_id,x.device_id);
  get diagnostics v_expired = row_count;
  if v_expired>0 then perform kc_private.ops_warn('dispatch_unknown','expired sending lease held; no payload logged'); end if;
  for j in select x.* from kc_private.dispatch_jobs x
    left join public.user_devices d on d.id = x.device_id and d.user_id = x.recipient_id
    where x.phase = p_phase and (p_phase='receipt' or d.id is not null) and x.available_at <= now()
      and (x.lease_until is null or x.lease_until <= now())
      and kc_private.dispatch_matches(p_scope,x.origin_event_id,x.notification_id,x.recipient_id,x.device_id)
    order by x.available_at,x.id limit least(greatest(p_limit,1),100)
    for update of x skip locked
  loop
    if p_phase = 'receipt' and j.accepted_at < now() - interval '24 hours' then
      update kc_private.dispatch_jobs set phase='failed',last_error='receipt_expired',finished_at=now(),lease_id=null,lease_until=null where id=j.id;
      continue;
    end if;
    if p_phase = 'pending' then
      select z.* into n from public.notifications z where z.id=j.notification_id and z.user_id=j.recipient_id;
      p := null;
      -- Re-evaluate read state and per-kind/category preferences before retrying too.
      if found and n.read_at is null and exists (
        select 1 from kc_private.notification_kinds k join public.user_private u on u.user_id=n.user_id
        join public.users a on a.id=n.user_id
        where k.kind=n.kind and (k.bypass_preferences or (a.is_active
          and not kc_access.is_blocked_between(n.user_id,j.actor_id)
          and kc_private.notification_kind_enabled(u.notification_preferences,k)))) then
        p := kc_private.notification_push(n,array[j.device_id]);
        if p is not null then
          -- Immutable per-origin rendering/route metadata, but live token, badge and name.
          p := j.snapshot || jsonb_build_object('tokens',p -> 'tokens','badge',p -> 'badge',
            'args',coalesce(j.snapshot -> 'args','{}'::jsonb) || jsonb_build_object('actor_display_name',
              (select a.display_name from public.users a where a.id=j.actor_id)));
        end if;
      end if;
      if p is null then
        update kc_private.dispatch_jobs set phase='skipped',last_error='no_longer_pushable',finished_at=now(),lease_id=null,lease_until=null where id=j.id;
        continue;
      end if;
      select d.push_token into v_token from public.user_devices d where d.id=j.device_id and d.user_id=j.recipient_id;
      if j.attempts >= 5 then
        update kc_private.dispatch_jobs set phase='failed',last_error='retry_limit',finished_at=now() where id=j.id;
        perform kc_private.ops_warn('dispatch_retry_limit','job retry limit reached; no payload logged');
        continue;
      end if;
    end if;
    update kc_private.dispatch_jobs set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',lease_scope=p_scope,
      token_hash=case when p_phase='pending' then encode(sha256(convert_to(v_token,'UTF8')),'hex') else token_hash end,
      attempts=attempts+case when p_phase='pending' then 1 else 0 end,
      receipt_attempts=receipt_attempts+case when p_phase='receipt' then 1 else 0 end
      where id=j.id returning * into j;
    return next jsonb_build_object('id',j.id,'lease_id',j.lease_id,'phase',j.phase,'attempts',j.attempts,
      'origin_event_id',j.origin_event_id,'notification_id',j.notification_id,'recipient_id',j.recipient_id,
      'device_id',j.device_id,'ticket_id',j.ticket_id,'push',case when p_phase='pending' then p end);
  end loop;
end;
$$;

-- Whole batch validation before any POST permission. All selected jobs must have a
-- current lease and unchanged device-token version. A token replaced after claim cannot
-- be used or invalidated by an old worker. No stale job in a batch is silently dropped.
create function kc_private.dispatch_begin_send(p_scope jsonb,p_jobs jsonb)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb; ids bigint[] := '{}'; j kc_private.dispatch_jobs; v_token text;
begin
  if not kc_private.dispatch_lock_gate(p_scope) then raise exception 'dispatch scope closed'; end if;
  if not kc_private.dispatch_preflight(p_scope) then raise exception 'dispatch scope closed'; end if;
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) not between 1 and 100 then
    raise exception 'invalid send batch';
  end if;
  for x in select value from jsonb_array_elements(p_jobs) order by (value ->> 'id')::bigint loop
    if jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>2
      or not (x ?& array['id','lease_id']) or jsonb_typeof(x -> 'id')<>'number'
      or jsonb_typeof(x -> 'lease_id')<>'string' then raise exception 'invalid send entry'; end if;
    if (x ->> 'id')::bigint = any(ids) then raise exception 'duplicate job'; end if;
    ids := array_append(ids,(x ->> 'id')::bigint);
    select * into j from kc_private.dispatch_jobs where id=(x ->> 'id')::bigint for update;
    if not found or not kc_private.dispatch_matches(p_scope,j.origin_event_id,j.notification_id,j.recipient_id,j.device_id)
      or j.lease_scope is distinct from p_scope or j.phase <> 'pending' or j.lease_id is distinct from (x ->> 'lease_id')::uuid
      or j.lease_until <= now() + interval '30 seconds' then raise exception 'stale dispatch lease'; end if;
    select push_token into v_token from public.user_devices where id=j.device_id and user_id=j.recipient_id;
    if not found or encode(sha256(convert_to(v_token,'UTF8')),'hex') <> j.token_hash then
      raise exception 'device token changed';
    end if;
  end loop;
  -- Eligibility can change between claim and POST permission. Refuse the whole batch;
  -- the next claim will apply the explicit skipped disposition, never delete inbox rows.
  if exists(select 1 from kc_private.dispatch_jobs q where q.id=any(ids) and not exists(
    select 1 from public.notifications n join public.users u on u.id=n.user_id
      join public.user_private p on p.user_id=u.id join kc_private.notification_kinds k on k.kind=n.kind
      where n.id=q.notification_id and n.user_id=q.recipient_id and n.read_at is null
        and (k.bypass_preferences or (u.is_active and not kc_access.is_blocked_between(u.id,q.actor_id)
          and kc_private.notification_kind_enabled(p.notification_preferences,k)))
        and kc_private.notification_push(n,array[q.device_id]) is not null)) then raise exception 'eligibility changed'; end if;
  update kc_private.dispatch_jobs set phase='sending' where id=any(ids);
  return query select jsonb_build_object('id',q.id,'badge',
    (select count(*) from public.notifications n where n.user_id=q.recipient_id and n.read_at is null))
    from kc_private.dispatch_jobs q where q.id=any(ids);
end;
$$;
-- Fenced whole-batch settlement. Caller supplies ids+lease tokens, not arbitrary device
-- ids to delete. A foreign/stale/duplicate job rejects the entire transaction. Accepted
-- ticket ids are immutable and remain on the same lineage row until receipt/expiry.
create function kc_private.dispatch_settle(p_scope jsonb,p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare x jsonb; j kc_private.dispatch_jobs; ids bigint[] := '{}'; s text;
begin
  if not kc_private.dispatch_scope_valid(p_scope) then raise exception 'invalid dispatch scope'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) not between 1 and 100 then
    raise exception 'invalid settlement batch';
  end if;
  -- Do not consult the activation gate for settling already-authorised POSTs: closing it
  -- stops new claims/POST permission, it cannot recall an in-flight provider request.
  for x in select value from jsonb_array_elements(p_results) order by (value ->> 'id')::bigint loop
    if jsonb_typeof(x)<>'object' or not (x ?& array['id','lease_id','state'])
      or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','lease_id','state','ticket_id'))
      or jsonb_typeof(x -> 'id')<>'number' or jsonb_typeof(x -> 'lease_id')<>'string'
      or jsonb_typeof(x -> 'state')<>'string' then raise exception 'invalid settlement entry'; end if;
    if (x ->> 'id')::bigint = any(ids) then raise exception 'duplicate job'; end if;
    ids := array_append(ids,(x ->> 'id')::bigint);
    select * into j from kc_private.dispatch_jobs where id=(x ->> 'id')::bigint for update;
    if not found or j.lease_id is distinct from (x ->> 'lease_id')::uuid or j.lease_id is null
      or j.lease_scope is distinct from p_scope or j.lease_until <= now() or j.phase not in ('pending','sending','receipt') then raise exception 'stale dispatch lease'; end if;
    if not (p_scope ? 'automatic') and not kc_private.dispatch_matches(p_scope,j.origin_event_id,j.notification_id,j.recipient_id,j.device_id) then
      raise exception 'foreign dispatch job';
    end if;
    s := x ->> 'state';
    if s is null or s not in ('accepted','retry','permanent','unknown','receipt_pending','provider_accepted','device_gone') then
      raise exception 'invalid settlement state';
    end if;
    if (j.phase='pending' and s<>'permanent')
      or (j.phase='sending' and s not in ('accepted','retry','permanent','unknown','device_gone'))
      or (j.phase='receipt' and s not in ('receipt_pending','provider_accepted','permanent','device_gone')) then
      raise exception 'settlement phase mismatch';
    end if;
    if s='accepted' and (nullif(x ->> 'ticket_id','') is null or length(x ->> 'ticket_id')>256 or j.ticket_id is not null) then
      raise exception 'invalid accepted ticket';
    end if;
  end loop;
  for x in select value from jsonb_array_elements(p_results) loop
    select * into j from kc_private.dispatch_jobs where id=(x ->> 'id')::bigint;
    s := x ->> 'state';
    if s='device_gone' then
      delete from public.user_devices d where d.id=j.device_id and d.user_id=j.recipient_id
        and encode(sha256(convert_to(d.push_token,'UTF8')),'hex')=j.token_hash;
    end if;
    update kc_private.dispatch_jobs set
      phase=case
        when s='accepted' then 'receipt'
        when s='receipt_pending' and accepted_at < now()-interval '24 hours' then 'failed'
        when s='receipt_pending' then 'receipt'
        when s='retry' and attempts<5 then 'pending'
        when s='provider_accepted' then 'provider_accepted'
        when s='unknown' then 'send_unknown'
        else 'failed' end,
      finished_at=case when s in ('permanent','device_gone','provider_accepted')
        or (s='retry' and attempts>=5) or (s='receipt_pending' and accepted_at<now()-interval '24 hours')
        then now() else null end,
      ticket_id=case when s='accepted' then x ->> 'ticket_id' else ticket_id end,
      accepted_at=case when s='accepted' then now() else accepted_at end,
      available_at=case when s in ('accepted','receipt_pending') then now()+interval '15 minutes'
        when s='retry' then now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) else available_at end,
      last_error=case when s in ('accepted','provider_accepted') then null else s end,
      lease_id=null,lease_until=null,lease_scope=null
      where id=j.id;
    if s in ('permanent','unknown') or (s='retry' and j.attempts>=5) then
      perform kc_private.ops_warn('dispatch_'||s,'job state requires review; no payload logged');
    end if;
  end loop;
end;
$$;
-- Dispatch-only modern-key invocation. The shared invoke_edge_function and all other
-- callers (including charging/model/media jobs) remain byte-for-byte unchanged.
create function kc_private.invoke_dispatch_scoped(p_scope jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_headers jsonb; v_request bigint;
begin
  if not kc_private.dispatch_scope_valid(p_scope) then return null; end if;
  if not kc_private.dispatch_preflight(p_scope) then return null; end if;
  if not kc_private.edge_invocation_ready() then return null; end if;
  execute 'select (select decrypted_secret from vault.decrypted_secrets where name=$1),
                  (select decrypted_secret from vault.decrypted_secrets where name=$2)'
    into v_url,v_key using 'kc_project_url','kc_service_role_key';
  if coalesce(v_url,'')='' or coalesce(v_key,'')='' then return null; end if;
  v_headers := jsonb_build_object('Content-Type','application/json','apikey',v_key);
  if v_key like 'eyJ%' then v_headers:=v_headers||jsonb_build_object('Authorization','Bearer '||v_key); end if;
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=$4)'
    into v_request using rtrim(v_url,'/')||'/functions/v1/dispatch-notification',
      jsonb_build_object('scope',p_scope),v_headers,30000;
  return v_request;
exception when others then
  perform kc_private.ops_warn('dispatch_invocation_failed','sqlstate '||sqlstate);
  return null;
end;
$$;

create function kc_private.dispatch_kick()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from kc_private.dispatch_gate) then return false; end if;
  perform 1 from kc_private.edge_function_kicks where function_name='dispatch-notification'
    and last_kick_at<=clock_timestamp()-debounce for update skip locked;
  if not found then return false; end if;
  update kc_private.edge_function_kicks set last_kick_at=clock_timestamp() where function_name='dispatch-notification';
  return kc_private.invoke_dispatch_scoped('{"automatic":true}'::jsonb) is not null;
exception when others then return false;
end;
$$;

create or replace function kc_private.outbox_events_kick_dispatcher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- A new epoch admits only inserts that occur while this gate exists. Old events and
  -- prior-epoch pending jobs are never adopted on activation/reactivation.
  insert into kc_private.dispatch_admissions(origin_event_id,epoch)
    select i.id,g.epoch from inserted i cross join kc_private.dispatch_gate g
    where i.topic='notification' on conflict do nothing;
  if exists(select 1 from inserted i where i.topic='notification' and i.available_at<=now()) then
    perform kc_private.dispatch_kick();
  end if;
  return null;
exception when others then
  perform kc_private.ops_warn('dispatch_admission_failed','sqlstate '||sqlstate);
  return null;
end;
$$;

create or replace function kc_private.push_dispatch_tick()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from kc_private.dispatch_gate) then return false; end if;
  if exists(select 1 from kc_private.outbox_events e
    join kc_private.dispatch_admissions a on a.origin_event_id=e.id
    join kc_private.dispatch_gate g on g.epoch=a.epoch
    where e.topic='notification' and e.processed_at is null and e.available_at<=now())
    or exists(select 1 from kc_private.dispatch_jobs j
      join kc_private.dispatch_admissions a on a.origin_event_id=j.origin_event_id
      join kc_private.dispatch_gate g on g.epoch=a.epoch
      where j.phase in ('pending','receipt','sending') and j.available_at<=now()) then
    return kc_private.invoke_dispatch_scoped('{"automatic":true}'::jsonb) is not null;
  end if;
  return false;
end;
$$;
-- Extend the EXISTING processed-outbox retention pass to terminal dispatch jobs. No new
-- cron, and no change to the old outbox deletion condition/return count. send_unknown
-- and other unresolved work stay held and visible for explicit review, just like the
-- existing unprocessed outbox policy. Account deletion cascades the recipient's jobs.
create or replace function kc_private.outbox_purge(p_keep interval)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_rows bigint;
begin
  delete from kc_private.outbox_events e
    where e.processed_at is not null and e.processed_at<now()-p_keep;
  get diagnostics v_rows=row_count;
  delete from kc_private.dispatch_jobs j where j.finished_at is not null and j.finished_at<now()-p_keep;
  delete from kc_private.dispatch_admissions a where not exists(
    select 1 from kc_private.outbox_events e where e.id=a.origin_event_id)
    and not exists(select 1 from kc_private.dispatch_jobs j where j.origin_event_id=a.origin_event_id);
  return v_rows;
end;
$$;
