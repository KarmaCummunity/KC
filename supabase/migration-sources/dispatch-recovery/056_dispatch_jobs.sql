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
  -- Select by immutable job lineage, even if the device disappeared or changed owner.
  -- Explicit foreign scopes were rejected by preflight; eligible origin/automatic scopes
  -- must reach the terminal no_longer_pushable path instead of stranding pending jobs.
  for j in select x.* from kc_private.dispatch_jobs x
    where x.phase = p_phase and x.available_at <= now()
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
