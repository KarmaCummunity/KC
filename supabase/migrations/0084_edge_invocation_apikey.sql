-- Scoped dispatch activation (#856 live 401): modern key compatibility for the
-- notification dispatcher ONLY.
--
-- The shared kc_private.invoke_edge_function is deliberately UNCHANGED: every other
-- caller (subscription charge, embed, match rerank, research salt, purge, orphan and
-- EXIF workers) keeps its exact prior headers until a separately reviewed change.
--
-- Supabase's new secret keys (sb_secret_...) are not JWTs and are rejected on
-- Authorization: Bearer; they are accepted on the apikey header ("Migrating to
-- publishable and secret API keys"). The scoped invoker below sends `apikey` always and
-- adds the bearer header only for a legacy JWT key. The handler stays closed to any
-- unscoped call: the minute cron drains nothing until a reviewed release, and only an
-- explicitly scoped call (event/recipient/device filters across the notification, retry
-- and receipt queues) runs work.

-- Scoped claim: due events of a topic restricted to the listed ids, optionally filtered
-- by the notification, the recipient or the device in the payload. Anything outside the
-- filters is never claimed.
create function kc_private.outbox_claim_scoped(
  p_topic text,
  p_event_ids bigint[] default null,
  p_notification_id uuid default null,
  p_recipient uuid default null,
  p_device uuid default null,
  p_limit integer default 50,
  p_visibility_timeout interval default interval '2 minutes'
)
returns setof kc_private.outbox_events
language sql
security definer
set search_path = ''
as $$
  update kc_private.outbox_events e
     set claimed_at = now(),
         attempts = e.attempts + 1
   where e.id in (
           select c.id
             from kc_private.outbox_events c
            where c.topic = p_topic
              and (p_event_ids is null or c.id = any(p_event_ids))
              and c.processed_at is null
              and c.available_at <= now()
              and (c.claimed_at is null or c.claimed_at <= now() - p_visibility_timeout)
              and (p_notification_id is null or (c.payload ->> 'notification_id')::uuid = p_notification_id)
              and (p_recipient is null or (c.payload ->> 'recipient_id')::uuid = p_recipient)
              and (p_device is null
                   or (c.payload -> 'device_ids') ? p_device::text
                   or exists (select 1 from jsonb_array_elements(coalesce(c.payload -> 'tickets', '[]'::jsonb)) t
                              where (t ->> 'device_id')::uuid = p_device))
            order by c.available_at, c.id
            limit least(greatest(p_limit, 1), 500)
              for update skip locked)
  returning e.*;
$$;
comment on function kc_private.outbox_claim_scoped(text, bigint[], uuid, uuid, uuid, integer, interval) is
  'Claims only the listed due events of a topic, filtered by notification/recipient/device; everything else stays queued.';

-- Scoped deliver: claims only the listed `notification` events (optionally one
-- recipient) and delivers them. Unlisted pending events are untouched.
create function kc_private.notifications_deliver_batch_scoped(
  p_event_ids bigint[],
  p_recipient uuid default null,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
begin
  for v_event_id in
    select e.id from kc_private.outbox_claim_scoped('notification', p_event_ids, null, p_recipient, null, p_limit) e order by e.id
  loop
    begin
      return next kc_private.notifications_deliver(v_event_id);
    exception when others then
      perform kc_private.outbox_complete(v_event_id, sqlerrm);
      return next jsonb_build_object('event_id', v_event_id, 'status', 'failed', 'reason', sqlerrm);
    end;
  end loop;
end;
$$;
comment on function kc_private.notifications_deliver_batch_scoped(bigint[], uuid, integer) is
  'Delivers only the listed notification events (optionally one recipient); the rest of the queue is untouched.';

-- Scoped retry: claims only the listed `notification_push` events (optionally one
-- notification or device) and rebuilds each push from its notification.
create function kc_private.notification_push_retry_batch_scoped(
  p_event_ids bigint[] default null,
  p_notification_id uuid default null,
  p_device uuid default null,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event kc_private.outbox_events;
  v_notification public.notifications;
  v_push jsonb;
begin
  for v_event in
    select e.* from kc_private.outbox_claim_scoped('notification_push', p_event_ids, p_notification_id, null, p_device, p_limit) e order by e.id
  loop
    begin
      v_push := null;
      select n.* into v_notification
        from public.notifications n
       where n.id = (v_event.payload ->> 'notification_id')::uuid and n.read_at is null;
      if found then
        v_push := kc_private.notification_push(v_notification,
          array(select jsonb_array_elements_text(v_event.payload -> 'device_ids'))::uuid[]);
      end if;
      if v_push is null then
        perform kc_private.outbox_complete(v_event.id);
        return next jsonb_build_object('event_id', v_event.id, 'status', 'skipped');
      else
        return next jsonb_build_object(
          'event_id', v_event.id, 'status', 'retry', 'attempts', v_event.attempts,
          'notification_id', v_notification.id, 'push', v_push);
      end if;
    exception when others then
      perform kc_private.outbox_complete(v_event.id, sqlerrm, interval '1 hour');
      return next jsonb_build_object('event_id', v_event.id, 'status', 'skipped');
    end;
  end loop;
end;
$$;
comment on function kc_private.notification_push_retry_batch_scoped(bigint[], uuid, uuid, integer) is
  'Retries only the listed push events (optionally one notification or device); the rest of the queue is untouched.';

-- Scoped invoker: queues one POST to dispatch-notification with an explicit scope body,
-- authorised with the Vault key on the apikey header (bearer added only for a legacy JWT
-- key). Returns the pg_net request id, or null with a warning like invoke_edge_function.
create function kc_private.invoke_dispatch_scoped(p_scope jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_headers jsonb;
  v_request_id bigint;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object'
     or (not (p_scope ? 'event_ids') and not (p_scope ? 'notification_id')
         and not (p_scope ? 'recipient_id') and not (p_scope ? 'device_id')) then
    perform kc_private.ops_warn('edge_invocation_invalid_scope', 'a scoped dispatch needs at least one filter');
    return null;
  end if;
  if not kc_private.edge_invocation_ready() then
    perform kc_private.ops_warn('edge_invocation_unavailable',
      'pg_net or Vault is not installed; dispatch-notification was not invoked');
    return null;
  end if;

  execute 'select (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1),
                  (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $2)'
     into v_url, v_key
    using 'kc_project_url', 'kc_service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    perform kc_private.ops_warn('edge_invocation_unconfigured',
      'Vault secret kc_project_url or kc_service_role_key is missing; dispatch-notification was not invoked');
    return null;
  end if;

  v_headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key);
  if v_key like 'eyJ%' then
    -- A legacy JWT key is accepted as the bearer token too; a new sb_secret key is not a
    -- JWT and would be rejected on that header, so it goes on apikey only.
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_key);
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
     into v_request_id
    using rtrim(v_url, '/') || '/functions/v1/dispatch-notification',
          jsonb_build_object('scope', p_scope),
          v_headers,
          30000;
  return v_request_id;
exception when others then
  perform kc_private.ops_warn('edge_invocation_failed:dispatch-notification', 'sqlstate ' || sqlstate);
  return null;
end;
$$;
comment on function kc_private.invoke_dispatch_scoped(jsonb) is
  'Starts dispatch-notification with an explicit event/recipient/device scope; apikey-header auth, never the generic drain.';
