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
