-- Notifications · the push of a notification
--
-- What the push worker (`dispatch-notification` Edge Function) needs to send one
-- notification to the member's devices, built from the notification row at the moment it is
-- asked for — at delivery (030_notification_delivery.sql) and again at a retry
-- (070_push_retry.sql) — so device tokens, quiet hours and the badge are always current and
-- nothing but ids waits in a queue.
--
-- The push (jsonb):
--   { "tokens": [{ "device_id", "token", "platform" }],
--     "title_key", "body_key",
--     "args": { …the notification's data, "actor_display_name" },
--     "data": { "notification_id", "kind", "category", "entity": { "type", "id" } | null,
--               "group_count" },
--     "collapse_key": "<group key|null>",
--     "badge": <the member's unread notifications> }
-- The worker renders the text from the keys and chooses the platform fields from the kind's
-- row of the registry. For chat kinds `args.message_id` names the message; the worker reads
-- its preview itself (kc_private.notification_message_previews), so message text never
-- passes through a queue.

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

-- The push of one notification, or null when nothing may be pushed now: the kind is shown
-- in the centre only (S10), the member is in quiet hours and the kind does not pass them
-- (D95), or no device is registered. `p_device_ids` narrows the push to those devices — a
-- retry reaches only the devices the first attempt missed.
create function kc_private.notification_push(p_notification public.notifications, p_device_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind kc_private.notification_kinds;
  v_preferences jsonb;
  v_tokens jsonb;
begin
  select k.* into v_kind from kc_private.notification_kinds k where k.kind = p_notification.kind;
  if not found or not v_kind.sends_push then
    return null;
  end if;
  if not (v_kind.bypass_preferences or v_kind.bypass_quiet_hours) then
    select p.notification_preferences into v_preferences
      from public.user_private p where p.user_id = p_notification.user_id;
    if kc_private.notification_in_quiet_hours(v_preferences) then
      return null;
    end if;
  end if;

  -- Oldest registration first, so the order of the tokens is stable between attempts.
  select jsonb_agg(jsonb_build_object('device_id', d.id, 'token', d.push_token, 'platform', d.platform)
                   order by d.created_at, d.id)
    into v_tokens
    from public.user_devices d
   where d.user_id = p_notification.user_id
     and (p_device_ids is null or d.id = any (p_device_ids));
  if v_tokens is null then
    return null;
  end if;

  return jsonb_build_object(
    'tokens', v_tokens,
    'title_key', p_notification.title_key,
    'body_key', p_notification.body_key,
    'args', p_notification.data || jsonb_build_object('actor_display_name',
      (select u.display_name from public.users u where u.id = p_notification.actor_ids[1])),
    'data', jsonb_build_object(
      'notification_id', p_notification.id, 'kind', p_notification.kind,
      'category', p_notification.category,
      'entity', case when p_notification.entity_id is not null then jsonb_build_object(
        'type', p_notification.entity_type, 'id', p_notification.entity_id) end,
      'group_count', p_notification.group_count),
    'collapse_key', p_notification.group_key,
    -- The number on the app icon: everything the member has not read, this one included.
    'badge', (select count(*) from public.notifications n
               where n.user_id = p_notification.user_id and n.read_at is null));
end;
$$;
comment on function kc_private.notification_push(public.notifications, uuid[]) is
  'What the push worker sends for a notification (tokens, text keys, arguments, badge), or null when it may not be pushed now.';
