-- Notifications · delivery (the consumer of outbox topic `notification`)
--
-- A worker — the `dispatch-notification` Edge Function, running as the service role — asks
-- for a batch with kc_private.notifications_deliver_batch(). For each event the database
-- decides everything that needs data: whether the member wants the notification, whether
-- it merges into an existing one, and whether a push may be sent now. The worker only
-- renders the text and talks to the push provider.
--
-- Result of one event (jsonb):
--   { "event_id": 1, "status": "delivered" | "skipped", "reason": "<why skipped>",
--     "notification_id": "<uuid>", "group_count": 1,
--     "push": null | { "tokens": [{ "token", "platform" }], "title_key", "body_key",
--                      "args": { …event data, "actor_display_name" },
--                      "data": { "notification_id", "kind", "category", "entity", "group_count" },
--                      "collapse_key": "<group key|null>" } }
-- `push` is null when nothing may be pushed: the kind is centre-only, the member is in
-- quiet hours, or has no device. For chat kinds `args.message_id` names the message; the
-- worker reads its preview itself, so message text never passes through the queue.
-- The event is confirmed in the same transaction as the notification row, so a notification
-- is written exactly once; a push is sent at most once.

-- Whether a member wants a kind: the switch of its category (FR-NOTIF-014) and the kind's
-- own switch, which falls back to the kind's default (FR-NOTIF-017). Only an explicit
-- JSON boolean counts, whatever else a client stored in the preferences.
create function kc_private.notification_kind_enabled(p_preferences jsonb, p_kind kc_private.notification_kinds)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_preferences -> p_kind.category is distinct from 'false'::jsonb
     and case p_preferences -> 'kinds' -> p_kind.kind
           when 'true'::jsonb then true
           when 'false'::jsonb then false
           else p_kind.default_enabled
         end;
$$;
comment on function kc_private.notification_kind_enabled(jsonb, kc_private.notification_kinds) is
  'A member''s preferences allow the kind: category switch and per-kind switch.';

-- Whether p_at falls in the member's quiet hours (spec 07 §7.11): preferences
-- `quietHours { enabled, start, end, timezone }`, by default 22:00–08:00 Israel time once
-- enabled. A window may cross midnight. Values a client stored that cannot be read as a
-- time or a time zone mean "no quiet hours" rather than a failed delivery.
create function kc_private.notification_in_quiet_hours(p_preferences jsonb, p_at timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_quiet constant jsonb := p_preferences -> 'quietHours';
  v_start time;
  v_end time;
  v_local time;
begin
  if v_quiet -> 'enabled' is distinct from 'true'::jsonb then
    return false;
  end if;
  v_start := coalesce(v_quiet ->> 'start', '22:00')::time;
  v_end := coalesce(v_quiet ->> 'end', '08:00')::time;
  v_local := (p_at at time zone coalesce(v_quiet ->> 'timezone', 'Asia/Jerusalem'))::time;
  if v_start <= v_end then
    return v_local >= v_start and v_local < v_end;
  end if;
  return v_local >= v_start or v_local < v_end;
exception when others then
  return false;
end;
$$;
comment on function kc_private.notification_in_quiet_hours(jsonb, timestamptz) is
  'The moment falls inside the quiet hours of the given notification preferences.';

-- Turns one outbox event into a notification and returns the result described above.
create function kc_private.notifications_deliver(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event kc_private.outbox_events;
  v_kind kc_private.notification_kinds;
  v_to uuid;
  v_actor_id uuid;
  v_entity jsonb;
  v_data jsonb;
  v_dedupe_key text;
  v_group_key text;
  v_preferences jsonb;
  v_is_active boolean;
  v_reason text;
  v_notification public.notifications;
  v_tokens jsonb;
begin
  select e.* into v_event
    from kc_private.outbox_events e
   where e.id = p_event_id and e.topic = 'notification' and e.processed_at is null
     for update;
  if not found then
    return jsonb_build_object('event_id', p_event_id, 'status', 'skipped', 'reason', 'already_processed');
  end if;

  select k.* into v_kind from kc_private.notification_kinds k where k.kind = v_event.payload ->> 'kind';
  if not found then
    raise exception 'unknown_notification_kind' using errcode = 'P0001', detail = v_event.payload ->> 'kind';
  end if;
  v_to := (v_event.payload ->> 'recipient_id')::uuid;
  v_actor_id := (v_event.payload ->> 'actor_id')::uuid;
  v_entity := nullif(v_event.payload -> 'entity', 'null'::jsonb);
  v_data := coalesce(nullif(v_event.payload -> 'data', 'null'::jsonb), '{}'::jsonb);
  v_dedupe_key := v_data ->> 'dedupe_key';
  v_data := v_data - 'dedupe_key';

  select u.is_active, p.notification_preferences into v_is_active, v_preferences
    from public.users u
    join public.user_private p on p.user_id = u.id
   where u.id = v_to;
  v_reason := case
    when not found then 'recipient_missing'
    when v_kind.bypass_preferences then null
    -- FR-NOTIF-011 AC2: a member whose account is not active is not notified.
    when not v_is_active then 'recipient_inactive'
    -- D105: nothing one member of a blocked pair does reaches the other.
    when kc_access.is_blocked_between(v_to, v_actor_id) then 'blocked'
    when not kc_private.notification_kind_enabled(v_preferences, v_kind) then 'preferences'
  end;

  if v_reason is null then
    -- One delivery at a time per member: the dedupe and the merge below read then write.
    perform pg_advisory_xact_lock(hashtextextended(v_to::text, 0));
    if v_dedupe_key is not null then
      insert into kc_private.notification_dedupe (user_id, dedupe_key)
      values (v_to, v_dedupe_key)
      on conflict do nothing;
      if not found then
        v_reason := 'duplicate';
      end if;
    end if;
  end if;
  if v_reason is not null then
    perform kc_private.outbox_complete(p_event_id);
    return jsonb_build_object('event_id', p_event_id, 'status', 'skipped', 'reason', v_reason);
  end if;

  -- Merge into the member's unread notification of the same kind and entity when its last
  -- event is inside the group window; the newest actor moves to the front.
  if v_kind.group_window is not null and v_entity ->> 'id' is not null then
    v_group_key := v_kind.kind || ':' || (v_entity ->> 'type') || ':' || (v_entity ->> 'id');
    update public.notifications n
       set group_count = n.group_count + 1,
           actor_ids = (array_remove(v_actor_id || array_remove(n.actor_ids, v_actor_id), null))[1:5],
           data = v_data,
           updated_at = now()
     where (n.id, n.created_at) = (
             select o.id, o.created_at
               from public.notifications o
              where o.user_id = v_to and o.group_key = v_group_key and o.read_at is null
                and o.updated_at > now() - v_kind.group_window
              order by o.created_at desc
              limit 1)
    returning n.* into v_notification;
  end if;
  if v_notification.id is null then
    insert into public.notifications (
      user_id, kind, category, world_slug, entity_type, entity_id, title_key, body_key, data,
      group_key, actor_ids)
    values (
      v_to, v_kind.kind, v_kind.category, v_data ->> 'world_slug', v_entity ->> 'type',
      (v_entity ->> 'id')::uuid, v_kind.title_key, v_kind.body_key, v_data, v_group_key,
      array_remove(array[v_actor_id], null))
    returning * into v_notification;
  end if;

  if v_kind.sends_push and (v_kind.bypass_preferences or v_kind.bypass_quiet_hours
                            or not kc_private.notification_in_quiet_hours(v_preferences)) then
    select jsonb_agg(jsonb_build_object('token', d.push_token, 'platform', d.platform))
      into v_tokens
      from public.user_devices d where d.user_id = v_to;
  end if;

  perform kc_private.outbox_complete(p_event_id);
  return jsonb_build_object(
    'event_id', p_event_id, 'status', 'delivered',
    'notification_id', v_notification.id, 'group_count', v_notification.group_count,
    'push', case when v_tokens is not null then jsonb_build_object(
      'tokens', v_tokens,
      'title_key', v_kind.title_key,
      'body_key', v_kind.body_key,
      'args', v_data || jsonb_build_object('actor_display_name',
        (select u.display_name from public.users u where u.id = v_actor_id)),
      'data', jsonb_build_object(
        'notification_id', v_notification.id, 'kind', v_kind.kind, 'category', v_kind.category,
        'entity', v_entity, 'group_count', v_notification.group_count),
      'collapse_key', v_group_key) end);
end;
$$;
comment on function kc_private.notifications_deliver(bigint) is
  'Consumer of outbox topic notification: writes or merges the notification and returns the push to send.';

-- Worker entry point: claims due `notification` events, delivers each and returns one
-- result per event. An event that fails is released for a retry with its error (status
-- "failed") and does not stop the batch.
create function kc_private.notifications_deliver_batch(p_limit integer default 50)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
begin
  for v_event_id in
    select e.id from kc_private.outbox_claim('notification', p_limit) e order by e.id
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
comment on function kc_private.notifications_deliver_batch(integer) is
  'Claims a batch of notification events and delivers them; returns one result per event.';
