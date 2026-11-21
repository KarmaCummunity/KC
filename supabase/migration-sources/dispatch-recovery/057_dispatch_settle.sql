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
