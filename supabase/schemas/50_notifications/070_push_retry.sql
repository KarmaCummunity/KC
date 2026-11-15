-- Notifications · push worker queues (retries and provider receipts)
--
-- The inbox row of a notification is written exactly once by the delivery function. What
-- can fail afterwards is the hand-over to the push provider, and that has its own two
-- outbox topics, so that a retry never touches the inbox again:
--   notification_push          { "notification_id", "device_ids": [uuid] }
--       a push the provider did not take (rate limit, outage); retried with back-off for
--       the listed devices only, rebuilt from the notification at that time.
--   notification_push_receipt  { "tickets": [{ "id", "device_id" }] }
--       tickets the provider accepted; a while later the worker asks for their receipts
--       and forgets the devices the provider reports as gone (FR-NOTIF-015 AC3).
-- Neither payload carries a token or any text. The worker (`dispatch-notification`) calls
-- only the functions of this file, kc_private.notifications_deliver_batch and
-- kc_private.outbox_claim — one round trip each per run.

-- Previews of chat messages for the push of chat kinds: the first 80 characters of the
-- text (FR-NOTIF-001 AC1); null for a message without text (media, system).
create function kc_private.notification_message_previews(p_message_ids uuid[])
returns table (message_id uuid, preview text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, left(m.body, 80)
    from public.messages m
   where m.id = any (p_message_ids);
$$;
comment on function kc_private.notification_message_previews(uuid[]) is
  'First 80 characters of the listed chat messages, read by the push worker at send time.';

-- Claims due `notification_push` events and returns, per event, the push to send again:
--   { "event_id", "status": "retry", "attempts", "notification_id", "push": {…} }
-- The event stays claimed until the worker settles it. An event whose notification is
-- gone, was read meanwhile, or may not be pushed now is confirmed here and reported as
--   { "event_id", "status": "skipped" }.
create function kc_private.notification_push_retry_batch(p_limit integer default 50)
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
    select e.* from kc_private.outbox_claim('notification_push', p_limit) e order by e.id
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
      -- An unreadable event must not spin: it waits an hour with its error recorded.
      perform kc_private.outbox_complete(v_event.id, sqlerrm, interval '1 hour');
      return next jsonb_build_object('event_id', v_event.id, 'status', 'skipped');
    end;
  end loop;
end;
$$;
comment on function kc_private.notification_push_retry_batch(integer) is
  'Claims due push retries and returns the push of each, rebuilt from its notification.';

-- Records everything one worker run learned, in one call:
--   { "forget_devices": [uuid],            devices the provider reports as gone
--     "defer":   [{ "notification_id", "device_ids", "retry_in_seconds" }],
--                                          first attempts that failed for now
--     "retry":   [{ "event_id", "device_ids", "error", "retry_in_seconds" }],
--                                          claimed events to try again later; `device_ids`
--                                          (optional) narrows the event to what still failed
--     "done":    [event_id],               claimed events that are finished
--     "receipts": [[{ "id", "device_id" }]],   accepted tickets, one event per inner list
--     "receipt_delay_seconds": 900 }
-- `retry` and `done` only ever touch events of the two topics of this file.
create function kc_private.notification_push_settle(p_outcome jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retry record;
begin
  delete from public.user_devices d
   where d.id in (select x::uuid from jsonb_array_elements_text(p_outcome -> 'forget_devices') x);

  perform kc_private.outbox_enqueue('notification_push',
            jsonb_build_object('notification_id', x.notification_id, 'device_ids', x.device_ids),
            now() + make_interval(secs => coalesce(x.retry_in_seconds, 30)))
     from jsonb_to_recordset(p_outcome -> 'defer')
            as x (notification_id uuid, device_ids jsonb, retry_in_seconds integer);

  for v_retry in
    select x.*
      from jsonb_to_recordset(p_outcome -> 'retry')
             as x (event_id bigint, device_ids jsonb, error text, retry_in_seconds integer)
      join kc_private.outbox_events e on e.id = x.event_id
     where e.topic in ('notification_push', 'notification_push_receipt')
  loop
    if v_retry.device_ids is not null then
      update kc_private.outbox_events e
         set payload = e.payload || jsonb_build_object('device_ids', v_retry.device_ids)
       where e.id = v_retry.event_id and e.processed_at is null;
    end if;
    perform kc_private.outbox_complete(v_retry.event_id, coalesce(v_retry.error, 'retry'),
              make_interval(secs => coalesce(v_retry.retry_in_seconds, 60)));
  end loop;

  perform kc_private.outbox_complete(e.id)
     from kc_private.outbox_events e
    where e.id in (select x::bigint from jsonb_array_elements_text(p_outcome -> 'done') x)
      and e.topic in ('notification_push', 'notification_push_receipt');

  perform kc_private.outbox_enqueue('notification_push_receipt',
            jsonb_build_object('tickets', x.tickets),
            now() + make_interval(secs => coalesce((p_outcome ->> 'receipt_delay_seconds')::integer, 900)))
     from jsonb_array_elements(p_outcome -> 'receipts') as x (tickets)
    where jsonb_array_length(x.tickets) > 0;
end;
$$;
comment on function kc_private.notification_push_settle(jsonb) is
  'Push worker: forgets dead devices, schedules retries, confirms finished events and queues receipt checks.';
